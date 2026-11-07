# Super Chat, Go

`protocol`: plugin manifest, editor card and chart card validators and an incremental SSE parser.
The TypeScript package in `packages/protocol` is the reference; this port reproduces every case in
[`../../conformance`](../../conformance/README.md), messages included. Standard library only.

```bash
go test ./...                              # conformance cases
go test ./protocol -bench . -benchmem      # chart card validation about 1.6 µs, 2 allocations
go vet ./... && gofmt -l .
```

Inputs are decoded JSON (`json.Unmarshal` into `any`). Apache-2.0. Copyright SUPER SOLUTION LABS INC.
