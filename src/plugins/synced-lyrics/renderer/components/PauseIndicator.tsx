import { createMemo } from 'solid-js';
import { currentTime } from '../renderer';

interface PauseIndicatorProps {
  startTime: number;
  endTime: number;
}

export const PauseIndicator = (props: PauseIndicatorProps) => {
  const state = createMemo(() => {
    const time = currentTime();
    const START_BUFFER = 1000; // Show 1s before pause starts
    const ANIMATION_DURATION = 600; // Exactly matches our CSS animation duration (0.6s)
    
    // State: 'hidden' | 'entering' | 'active' | 'exiting'
    if (time < props.startTime - START_BUFFER) {
      return 'hidden';
    } else if (time >= props.startTime - START_BUFFER && time < props.startTime) {
      return 'entering';
    } else if (time >= props.startTime && time < props.endTime - ANIMATION_DURATION) {
      return 'active';
    } else if (time >= props.endTime - ANIMATION_DURATION && time < props.endTime) {
      return 'exiting';
    } else {
      return 'hidden';
    }
  });

  return (
    <div class={`pause-indicator pause-${state()}`}>
      <span class="pause-dot"></span>
      <span class="pause-dot"></span>
      <span class="pause-dot"></span>
    </div>
  );
};
