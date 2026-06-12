// glimpseui (the native WebView2 host wrapper) ships no type declarations. We
// consume it through `(await import("glimpseui")) as any` in src/ui/launch.ts;
// this ambient shim just stops TS7016 (implicit-any module) under `tsc`.
declare module "glimpseui";
