// Type shims for packages whose types aren't resolvable under
// moduleResolution:"node" (ink v3 ships types via exports map quirks).

declare module 'ink' {
  import { ComponentType, ReactElement } from 'react';

  export interface InkRenderResult {
    waitUntilExit(): Promise<void>;
    unmount(): void;
    clear(): void;
  }

  export function render(tree: ReactElement, options?: Record<string, unknown>): InkRenderResult;

  export const Box: ComponentType<any>;
  export const Text: ComponentType<any>;
  export const Static: ComponentType<any>;

  export function useApp(): { exit(): void };

  export interface Key {
    upArrow: boolean;
    downArrow: boolean;
    leftArrow: boolean;
    rightArrow: boolean;
    return: boolean;
    escape: boolean;
    ctrl: boolean;
    meta: boolean;
    shift: boolean;
    tab: boolean;
    backspace: boolean;
    delete: boolean;
  }

  export function useInput(
    handler: (input: string, key: Key) => void,
    options?: { isActive?: boolean }
  ): void;
}
