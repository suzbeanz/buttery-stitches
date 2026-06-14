declare module "imagetracerjs" {
  interface ImageLike {
    width: number;
    height: number;
    data: Uint8ClampedArray | Uint8Array;
  }
  const ImageTracer: {
    imagedataToTracedata(
      imgd: ImageLike,
      options?: Record<string, unknown>,
    ): unknown;
    imagedataToSVG(imgd: ImageLike, options?: Record<string, unknown>): string;
  };
  export default ImageTracer;
}
