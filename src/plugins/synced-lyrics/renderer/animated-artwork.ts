import type { SongInfo } from '@/providers/song-info';

type NetFetch = (
  url: string,
  init?: RequestInit,
) => Promise<[number, string, Record<string, string>]>;

interface iTunesResult {
  resultCount: number;
  results: Array<{
    trackId: number;
    collectionId: number;
    trackName: string;
    artistName: string;
    collectionName: string;
    artworkUrl100: string;
    trackViewUrl: string;
    collectionViewUrl: string;
    releaseDate?: string;
  }>;
}

/** Resize an iTunes artwork URL to the requested square dimensions. */
function resizeArtworkUrl(url: string, size = 600): string {
  return url
    .replace(/w\d+-h\d+/, `w${size}-h${size}`)
    .replace(/\d+x\d+bb/, `${size}x${size}bb`);
}

/**
 * Extracts storefront + resource type + id from an Apple Music URL.
 * Falls back to us/albums/{id} when the URL can't be parsed.
 */
function parseCatalogTarget(
  url: string,
): { storefront: string; resourceType: string; resourceId: string } | null {
  const albumMatch = url.match(/music\.apple\.com\/(?:([a-z]{2})\/)?album\/(?:[^/]+\/)?(\d+)/i);
  if (albumMatch) {
    return { storefront: albumMatch[1] || 'us', resourceType: 'albums', resourceId: albumMatch[2] };
  }
  const playlistMatch = url.match(
    /music\.apple\.com\/(?:([a-z]{2})\/)?playlist\/(?:[^/]+\/)?(pl\.[a-z0-9]+)/i,
  );
  if (playlistMatch) {
    return { storefront: playlistMatch[1] || 'us', resourceType: 'playlists', resourceId: playlistMatch[2] };
  }
  return null;
}

/**
 * Extracts the Apple Music JWT bearer token from a JS bundle fetched
 * from the album page. The token is embedded in any /assets/*.js file
 * whose name contains index/web-client/apple-music.
 */
async function fetchBearerToken(albumUrl: string, netFetch: NetFetch): Promise<string | null> {
  try {
    const [status, html] = await netFetch(albumUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (status !== 200) return null;

    const jsPaths = Array.from(html.matchAll(/\/assets\/[^"']+\.js/gi)).map((m) => m[0]);
    const candidates = jsPaths.filter((p) => /index|web-client|apple-music/i.test(p));

    for (const jsPath of candidates.slice(0, 5)) {
      const jsUrl = jsPath.startsWith('http') ? jsPath : `https://music.apple.com${jsPath}`;
      const [jsStatus, jsText] = await netFetch(jsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (jsStatus !== 200) continue;
      const tokenMatch = jsText.match(/["'](eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+)["']/);
      if (tokenMatch) return tokenMatch[1];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Queries the Apple Music catalog API for an album's animated artwork.
 * Returns an HLS .m3u8 URL (square variant) when available.
 */
async function fetchAnimatedVideoUrl(appleMusicUrl: string, netFetch: NetFetch): Promise<string | null> {
  const target = parseCatalogTarget(appleMusicUrl);
  if (!target) return null;

  const token = await fetchBearerToken(appleMusicUrl, netFetch);
  if (!token) return null;

  const apiUrl = `https://amp-api.music.apple.com/v1/catalog/${target.storefront}/${target.resourceType}/${target.resourceId}?extend=editorialVideo&platform=web`;
  try {
    const [status, body] = await netFetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: 'https://music.apple.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (status !== 200) return null;
    const data = JSON.parse(body) as {
      data?: Array<{
        attributes?: {
          editorialVideo?: {
            motionDetailSquare?: { video?: string };
            motionDetailTall?: { video?: string };
          };
        };
      }>;
    };
    const videos = data.data?.[0]?.attributes?.editorialVideo;
    return videos?.motionDetailSquare?.video ?? videos?.motionDetailTall?.video ?? null;
  } catch {
    return null;
  }
}

/**
 * Queries the iTunes Search API for a song, then resolves the Apple Music
 * animated artwork URL via the Apple Music catalog API.
 *
 * Returns a `videoSrc` (HLS .m3u8) when the album has Motion Art, plus a
 * high-resolution static artwork fallback.
 */
export async function fetchAnimatedArtwork(
  info: SongInfo,
  netFetch: NetFetch,
): Promise<{ videoSrc?: string; staticArtwork?: string }> {
  const { title, artist, album } = info;
  if (!title || !artist) return {};

  try {
    // Search iTunes for the track
    const query = encodeURIComponent(`${artist} ${title}`);
    const searchUrl = `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`;
    const [status, body] = await netFetch(searchUrl, {
      headers: { Accept: 'application/json' },
    });
    if (status !== 200) return {};

    const data = JSON.parse(body) as iTunesResult;
    let result = data.results?.[0];

    // Fallback: search by album when no song matched
    if (!result && album) {
      const albumQuery = encodeURIComponent(`${artist} ${album}`);
      const albumUrl = `https://itunes.apple.com/search?term=${albumQuery}&entity=album&limit=1`;
      const [aStatus, aBody] = await netFetch(albumUrl, {
        headers: { Accept: 'application/json' },
      });
      if (aStatus === 200) {
        const aData = JSON.parse(aBody) as iTunesResult;
        result = aData.results?.[0];
      }
    }
    if (!result) return {};

    const staticArtwork = resizeArtworkUrl(result.artworkUrl100, 600);
    const appleMusicUrl = result.collectionViewUrl || result.trackViewUrl;
    if (!appleMusicUrl) return { staticArtwork };

    const videoSrc = await fetchAnimatedVideoUrl(appleMusicUrl, netFetch);
    return videoSrc ? { videoSrc, staticArtwork } : { staticArtwork };
  } catch {
    return {};
  }
}
