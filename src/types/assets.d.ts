declare module '*.wasm' {
  const path: string;
  export default path;
}

declare module '*.bundled.js' {
  const path: string;
  export default path;
}
