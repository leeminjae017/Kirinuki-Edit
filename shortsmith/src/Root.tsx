import React from 'react';
import { Composition } from 'remotion';
import { Short, ShortProps } from './Short';

/* The renderer passes scene + urlBase as inputProps. env.url is a function, which cannot cross JSON,
   so it is rebuilt here from urlBase. */
type Input = { scene: ShortProps['scene']; urlBase: string; overlay?: boolean; frameMap?: number[] };

const Wrapped: React.FC<Input> = ({ scene, urlBase, overlay, frameMap }) =>
  <Short scene={scene} frameMap={frameMap} layers={{ body: !overlay }} env={{ url: (p) => urlBase + encodeURIComponent(p.replace(/\\/g, '/')) }} />;

export const Root: React.FC = () => (
  <Composition
    id="Short"
    component={Wrapped as any}
    defaultProps={{ scene: { fps: 60, width: 1080, height: 1920, duration: 1, body: { window: '' }, window: { x: 0, y: 407, w: 1080, h: 1139 }, captions: [] }, urlBase: '' } as unknown as Input}
    calculateMetadata={({ props }) => {
      const { scene: s, frameMap } = props as Input;
      return { fps: s.fps, width: s.width, height: s.height, durationInFrames: Math.max(1, frameMap ? frameMap.length : Math.round(s.duration * s.fps)) };
    }}
    fps={60} width={1080} height={1920} durationInFrames={60}
  />
);
