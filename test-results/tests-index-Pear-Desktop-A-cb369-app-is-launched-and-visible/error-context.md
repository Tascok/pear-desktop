# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/index.test.js >> Pear Desktop App - With default settings, app is launched and visible
- Location: tests/index.test.js:10:1

# Error details

```
Error: electron.launch: Process failed to launch!
Call log:
  - <launching> /home/gustavo/Documentos/yt-music/pear-desktop/node_modules/.pnpm/electron@42.5.0/node_modules/electron/dist/electron -r /home/gustavo/Documentos/yt-music/pear-desktop/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/lib/server/electron/loader.js --inspect=0 --remote-debugging-port=0 /home/gustavo/Documentos/yt-music/pear-desktop --no-sandbox --disable-gpu --whitelisted-ips= --disable-dev-shm-usage
  - <launched> pid=188217
  - [pid=188217][err] Debugger listening on ws://127.0.0.1:39883/598a2db9-50ee-442e-ada1-a55c4506e26d
  - [pid=188217][err] For help, see: https://nodejs.org/learn/getting-started/debugging
  - <ws connecting> ws://127.0.0.1:39883/598a2db9-50ee-442e-ada1-a55c4506e26d
  - <ws connected> ws://127.0.0.1:39883/598a2db9-50ee-442e-ada1-a55c4506e26d
  - [pid=188217][err] Debugger attached.
  - <ws disconnected> ws://127.0.0.1:39883/598a2db9-50ee-442e-ada1-a55c4506e26d code=1006 reason=
  - [pid=188217] <kill>
  - [pid=188217] <will force kill>
  - [pid=188217] exception while trying to kill process: Error: kill ESRCH
  - [pid=188217] <process did exit: exitCode=0, signal=null>
  - [pid=188217] starting temporary directories cleanup
  - [pid=188217] finished temporary directories cleanup

```

# Test source

```ts
  1  | import path from 'node:path';
  2  | import process from 'node:process';
  3  | 
  4  | import { test, expect, _electron as electron } from '@playwright/test';
  5  | 
  6  | process.env.NODE_ENV = 'test';
  7  | 
  8  | const appPath = path.resolve(import.meta.dirname, '..');
  9  | 
  10 | test('Pear Desktop App - With default settings, app is launched and visible', async () => {
> 11 |   const app = await electron.launch({
     |               ^ Error: electron.launch: Process failed to launch!
  12 |     cwd: appPath,
  13 |     args: [
  14 |       appPath,
  15 |       '--no-sandbox',
  16 |       '--disable-gpu',
  17 |       '--whitelisted-ips=',
  18 |       '--disable-dev-shm-usage',
  19 |     ],
  20 |   });
  21 | 
  22 |   const window = await app.firstWindow();
  23 | 
  24 |   const consentForm = await window.$(
  25 |     "form[action='https://consent.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com/save']",
  26 |   );
  27 |   if (consentForm) {
  28 |     await consentForm.click('button');
  29 |   }
  30 | 
  31 |   // const title = await window.title();
  32 |   // expect(title.replaceAll(/\s/g, ' ')).toEqual('Pear Desktop');
  33 | 
  34 |   const url = window.url();
  35 |   expect(
  36 |     url.startsWith(
  37 |       'https://music.\u0079\u006f\u0075\u0074\u0075\u0062\u0065.com',
  38 |     ),
  39 |   ).toBe(true);
  40 | 
  41 |   await app.close();
  42 | });
  43 | 
```