/* 대시보드 피드백 탭 미리보기 - 완성본을 굽는 바로 그 React 컴포넌트(src/Short.tsx)를 브라우저에서 돌린다.
   자막을 고치면 update() 한 번으로 화면이 바뀐다 (렌더 없음).

   빌드: npm run preview:build  ->  dashboard/js/vendor/dampreview.js (전역 DamPreview)

   feedback.js 는 원래 <video> 하나를 시계로 썼다. 그 코드를 그대로 두려고 video 흉내 객체를 돌려준다:
   currentTime (읽기 · 쓰기) · duration · paused · muted · src · play() · pause() ·
   addEventListener('timeupdate' | 'loadedmetadata' | 'play' | 'pause'). */
import React, { createRef } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Player, PlayerRef } from '@remotion/player';
import { Short } from '../src/Short';
import { Scene } from '../src/scene';

type Opts = { scene: Scene; url: (abs: string) => string };

export function mount(el: HTMLElement, opts: Opts) {
  let scene = opts.scene;
  const ref = createRef<PlayerRef>();
  const ev = new EventTarget();
  const fire = (n: string) => ev.dispatchEvent(new Event(n));
  let root: Root | null = createRoot(el);
  let bound = false, muted = false;

  const video = {
    src: 'scene',
    get currentTime() { return (ref.current?.getCurrentFrame() ?? 0) / scene.fps; },
    set currentTime(t: number) {
      ref.current?.seekTo(Math.max(0, Math.min(Math.round(t * scene.fps), Math.round(scene.duration * scene.fps) - 1)));
      fire('timeupdate');
    },
    get duration() { return scene.duration; },
    get paused() { return !ref.current?.isPlaying(); },
    get muted() { return muted; },
    set muted(m: boolean) { muted = m; if (m) ref.current?.mute(); else ref.current?.unmute(); },
    play() { ref.current?.play(); },
    pause() { ref.current?.pause(); },
    load() {},
    removeAttribute() {},
    addEventListener: (n: string, f: EventListener) => ev.addEventListener(n, f),
    removeEventListener: (n: string, f: EventListener) => ev.removeEventListener(n, f),
  };

  // The Player may not be mounted two frames after the first render - then nothing was bound and no 'timeupdate' ever
  // fired while playing: the dashboard clock and playhead line stood still (2026-09-30). Retry until it is there.
  let tries = 0;
  const bind = () => {
    const p = ref.current;
    if (bound) return;
    if (!p) { if (tries++ < 200) setTimeout(bind, 50); return; }
    bound = true;
    p.addEventListener('frameupdate', () => fire('timeupdate'));
    p.addEventListener('seeked', () => fire('timeupdate'));
    p.addEventListener('play', () => fire('play'));
    p.addEventListener('pause', () => fire('pause'));
    p.addEventListener('ended', () => fire('pause'));
    fire('loadedmetadata');
  };

  const render = () => {
    root?.render(
      <Player
        ref={ref}
        component={Short as any}
        inputProps={{ scene, env: { url: opts.url, preview: true } }}
        durationInFrames={Math.max(1, Math.round(scene.duration * scene.fps))}
        fps={scene.fps}
        compositionWidth={scene.width}
        compositionHeight={scene.height}
        style={{ width: '100%', height: '100%' }}
        controls={false}
        clickToPlay={false}
        doubleClickToFullscreen={false}
        spaceKeyToPlayOrPause={false}
        acknowledgeRemotionLicense
      />,
    );
    requestAnimationFrame(() => requestAnimationFrame(bind));
  };
  render();

  return {
    video,
    get scene() { return scene; },
    update(next: Scene) { scene = next; render(); fire('timeupdate'); },
    unmount() { root?.unmount(); root = null; },
  };
}
