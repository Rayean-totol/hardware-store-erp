// Minimal typing for the one bwip-js function the app uses (toSVG). The package's own
// declarations are not picked up under the bundler's module conditions.
declare module 'bwip-js' {
  export interface ToSvgOptions {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    paddingwidth?: number;
    paddingheight?: number;
  }
  export function toSVG(options: ToSvgOptions): string;
}
