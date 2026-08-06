# Glossary

| Term | Meaning |
|---|---|
| Memory | One immutable source turn. |
| Scope | The isolation boundary containing memories available to one retrieval run. |
| Session | An ordered group of memory turns. |
| Retrieval hit | A store-independent result produced by a retriever or evidence operator. |
| Candidate | A retrieval hit registered in the current run ledger and exposed through an opaque candidate reference. |
| Evidence | An exact memory successfully read during the current run. |
| Citation | A support claim attached to evidence selected by `finish`. |
| Evidence package | The sufficient/insufficient status, citations, summary, optional count, and inventory. |
| Retrieval profile | A configured collection of retrieval implementations, currently `fts5` or `pimem-hybrid`. |
| Fact index | A deterministic, rebuildable sidecar containing extracted temporal or numeric facts. |
| Benchmark record | The durable combination of retrieval output, answer output, metadata, and trace for one question. |
