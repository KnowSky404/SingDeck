# Supplemental package license texts

These packages omit complete license files from their published npm tarballs. Copies here supplement the runtime notice inventory generated from installed packages:

- `@bufbuild__protobuf.txt`: [Protobuf ES v2.17.0 Apache license](https://github.com/bufbuild/protobuf-es/blob/v2.17.0/LICENSE), followed by [Google Protobuf v33.0 BSD license](https://github.com/protocolbuffers/protobuf/blob/v33.0/LICENSE). Protobuf ES declares `(Apache-2.0 AND BSD-3-Clause)`; well-known types derive from Google's schemas.
- `@connectrpc__connect.txt`, `@connectrpc__connect-web.txt`: [Connect ES v2.3.0](https://github.com/connectrpc/connect-es/blob/v2.3.0/LICENSE).
- `react-remove-scroll-bar.txt`: [upstream MIT license at commit 8ca9ba5](https://github.com/theKashey/react-remove-scroll-bar/blob/8ca9ba5ea52de03308fe8ced94f7b159a44d28ff/LICENSE) for installed package 2.3.8 (author Anton Korzunov).

`bun run licenses:generate` combines these with license texts in all installed runtime dependency packages, and asserts no discovered runtime package is missing a license text. shadcn component source is MIT, [upstream license](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md); its separate license is included in `public/third-party-licenses.txt` as well.
