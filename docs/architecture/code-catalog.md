# Code Catalog

This file is generated from the TypeScript AST. It is the function-level directory for the project and must not be edited manually.

Run `npm run docs:catalog` after adding, removing, renaming, or moving source symbols.

## `src/agent-runtime/index.ts`

_No top-level functions, classes, or class methods._
## `src/agent-runtime/interactive-memory-agent.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `activeSkillPrompt(skill: InteractiveMemorySkill): string` | Implements the active skill prompt operation. | function | internal | [line 132](../../src/agent-runtime/interactive-memory-agent.ts#L132) |
| `interactiveMemorySystemPrompt(options: { domainPolicy: string; operatorRegistry: SearchOperatorCatalog; skill: InteractiveMemorySkill; }): string` | Implements the interactive memory system prompt operation. | function | exported | [line 139](../../src/agent-runtime/interactive-memory-agent.ts#L139) |
| `toolNames(context: BeforeToolCallContext): string[]` | Converts ol names. | function | internal | [line 155](../../src/agent-runtime/interactive-memory-agent.ts#L155) |
| `externalTool(definition: ExternalToolDefinition, capture: (call: ExternalToolCall) => void): AgentTool` | Implements the external tool operation. | function | internal | [line 164](../../src/agent-runtime/interactive-memory-agent.ts#L164) |
| `assertExternalDefinitions(definitions: readonly ExternalToolDefinition[]): void` | Validates external definitions and throws when invalid. | function | internal | [line 196](../../src/agent-runtime/interactive-memory-agent.ts#L196) |
| `InteractiveMemoryAgentSession` | Stateful Pi Agent session for live environments. | class | exported | [line 228](../../src/agent-runtime/interactive-memory-agent.ts#L228) |
| `InteractiveMemoryAgentSession.constructor(private readonly options: InteractiveMemoryAgentOptions)` | Creates a interactive memory agent session instance. | method | public | [line 248](../../src/agent-runtime/interactive-memory-agent.ts#L248) |
| `InteractiveMemoryAgentSession.toolResultMessages(results: readonly ExternalToolResult[]): ToolResultMessage[]` | Converts ol result messages. | method | private | [line 399](../../src/agent-runtime/interactive-memory-agent.ts#L399) |
| `InteractiveMemoryAgentSession.turn(input: InteractiveAgentInput): Promise<InteractiveAgentOutput>` | Implements the turn operation. | method | public | [line 425](../../src/agent-runtime/interactive-memory-agent.ts#L425) |
## `src/benchmark/amabench/answer-contract.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `renderEvidence(memory: PiMemResult["evidence"][number]): string` | Renders evidence. | function | internal | [line 31](../../src/benchmark/amabench/answer-contract.ts#L31) |
| `buildAmaBenchAnswerPrompt(context: AmaBenchAnswerContext): BenchmarkAnswerPrompt` | Converts PiMem output to the benchmark-owned answer prompt. | function | exported | [line 41](../../src/benchmark/amabench/answer-contract.ts#L41) |
## `src/benchmark/amabench/dataset-adapter.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `objectAt(value: unknown, path: string): JsonObject` | Implements the object at operation. | function | internal | [line 90](../../src/benchmark/amabench/dataset-adapter.ts#L90) |
| `arrayAt(value: unknown, path: string): unknown[]` | Implements the array at operation. | function | internal | [line 97](../../src/benchmark/amabench/dataset-adapter.ts#L97) |
| `sourceTextAt(value: unknown, path: string): string` | Implements the source text at operation. | function | internal | [line 104](../../src/benchmark/amabench/dataset-adapter.ts#L104) |
| `nullableSourceTextAt(value: unknown, path: string): string \| null` | Implements the nullable source text at operation. | function | internal | [line 111](../../src/benchmark/amabench/dataset-adapter.ts#L111) |
| `nonNegativeIntegerAt(value: unknown, path: string): number` | Implements the non negative integer at operation. | function | internal | [line 122](../../src/benchmark/amabench/dataset-adapter.ts#L122) |
| `booleanAt(value: unknown, path: string): boolean` | Implements the boolean at operation. | function | internal | [line 129](../../src/benchmark/amabench/dataset-adapter.ts#L129) |
| `memberAt(value: unknown, allowed: ReadonlySet<string>, path: string): T` | Implements the member at operation. | function | internal | [line 136](../../src/benchmark/amabench/dataset-adapter.ts#L136) |
| `questionUuidAt(value: unknown, path: string): string` | Implements the question uuid at operation. | function | internal | [line 148](../../src/benchmark/amabench/dataset-adapter.ts#L148) |
| `amaBenchScopeId(episodeId: number): string` | Implements the ama bench scope id operation. | function | exported | [line 156](../../src/benchmark/amabench/dataset-adapter.ts#L156) |
| `amaBenchSessionId(scopeId: string): string` | Implements the ama bench session id operation. | function | exported | [line 161](../../src/benchmark/amabench/dataset-adapter.ts#L161) |
| `amaBenchMemoryId(scopeId: string, sourceCoordinate: "task" \| `step:${number}`): string` | Implements the ama bench memory id operation. | function | exported | [line 166](../../src/benchmark/amabench/dataset-adapter.ts#L166) |
| `renderAmaBenchStep(options: { turnIndex: number; action: string \| null; observation: string \| null; }): string` | Mirrors the official runner's trajectory text without normalizing payloads. | function | exported | [line 176](../../src/benchmark/amabench/dataset-adapter.ts#L176) |
| `adaptAmaBenchV4(raw: unknown): AmaBenchAdapterResult` | Trusted input firewall for AMA-Bench v4. | function | exported | [line 199](../../src/benchmark/amabench/dataset-adapter.ts#L199) |
| `parseAmaBenchV4Jsonl(serialized: string): unknown[]` | Parses ama bench v4 jsonl. | function | exported | [line 361](../../src/benchmark/amabench/dataset-adapter.ts#L361) |
| `loadPinnedAmaBenchV4File(path: string): Promise<AmaBenchAdapterResult>` | Loads only the byte-exact official v4 test artifact. | function | exported | [line 383](../../src/benchmark/amabench/dataset-adapter.ts#L383) |
## `src/benchmark/amabench/evaluation-contract.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `assertSameIdentity(query: AmaBenchPrivateQuery, label: AmaBenchPrivateLabel, prediction: AmaBenchQuestionPrediction): void` | Validates same identity and throws when invalid. | function | internal | [line 38](../../src/benchmark/amabench/evaluation-contract.ts#L38) |
| `buildAmaBenchEvaluatorInput(query: AmaBenchPrivateQuery, label: AmaBenchPrivateLabel, prediction: AmaBenchQuestionPrediction): AmaBenchEvaluatorInput` | Joins labels only at the evaluator boundary, after a prediction is frozen. | function | exported | [line 70](../../src/benchmark/amabench/evaluation-contract.ts#L70) |
| `buildAmaBenchEpisodeSubmissions(predictions: readonly AmaBenchQuestionPrediction[]): AmaBenchEpisodeSubmission[]` | Builds ama bench episode submissions. | function | exported | [line 92](../../src/benchmark/amabench/evaluation-contract.ts#L92) |
## `src/benchmark/amabench/index.ts`

_No top-level functions, classes, or class methods._
## `src/benchmark/amabench/judge.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `buildAmaBenchJudgePrompt(input: AmaBenchEvaluatorInput): string` | Exact prompt shape used by the pinned upstream v4 Python evaluator. | function | exported | [line 66](../../src/benchmark/amabench/judge.ts#L66) |
| `normalizeAmaBenchJudgeText(text: string): string` | Python-compatible normalization from the official fallback evaluator. | function | exported | [line 94](../../src/benchmark/amabench/judge.ts#L94) |
| `tokenCounts(tokens: readonly string[]): Map<string, number>` | Converts ken counts. | function | internal | [line 103](../../src/benchmark/amabench/judge.ts#L103) |
| `amaBenchTokenF1(predicted: string, golden: string): number` | Multiset token F1 used when upstream cannot parse a binary judge answer. | function | exported | [line 110](../../src/benchmark/amabench/judge.ts#L110) |
| `parseAmaBenchJudgeAnswer(judgeAnswer: string, predictedAnswer: string, goldenAnswer: string): AmaBenchParsedJudgeAnswer` | Removes closed think blocks, then follows upstream's "last complete word" rule. | function | exported | [line 137](../../src/benchmark/amabench/judge.ts#L137) |
| `judgeAmaBenchQuestion(options: { input: AmaBenchEvaluatorInput; modelRuntime: PiModelRuntime; maxRunMs?: number; }): Promise<AmaBenchJudgeResult>` | Implements the judge ama bench question operation. | function | exported | [line 173](../../src/benchmark/amabench/judge.ts#L173) |
| `bucket(results: readonly AmaBenchJudgeResult[]): AmaBenchJudgeBucket` | Implements the bucket operation. | function | internal | [line 214](../../src/benchmark/amabench/judge.ts#L214) |
| `groupBy(results: readonly AmaBenchJudgeResult[], keyFor: (result: AmaBenchJudgeResult) => K): Partial<Record<K, AmaBenchJudgeBucket>>` | Implements the group by operation. | function | internal | [line 225](../../src/benchmark/amabench/judge.ts#L225) |
| `aggregateAmaBenchJudgeResults(results: readonly AmaBenchJudgeResult[]): AmaBenchJudgeAggregate` | Implements the aggregate ama bench judge results operation. | function | exported | [line 246](../../src/benchmark/amabench/judge.ts#L246) |
## `src/benchmark/answer-from-evidence.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `returnedModelMatches(requested: string, returned: string): boolean` | Checks whether the provider's response model matches the requested model. | function | exported | [line 36](../../src/benchmark/answer-from-evidence.ts#L36) |
| `answerSystemPrompt(prompt: BenchmarkAnswerPrompt, executionChecklist?: string): string` | Runs benchmark-owned answer synthesis after PiMem has finished retrieval. | function | internal | [line 41](../../src/benchmark/answer-from-evidence.ts#L41) |
| `runBenchmarkAnswer(options: { modelRuntime: PiModelRuntime; prompt: BenchmarkAnswerPrompt; maxRunMs?: number; executionChecklist?: string; }): Promise<BenchmarkAnswerResult>` | Runs benchmark answer. | function | exported | [line 50](../../src/benchmark/answer-from-evidence.ts#L50) |
## `src/benchmark/composition/ingest-evidence-benchmark.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `ingestEvidenceBenchmark(options: IngestEvidenceBenchmarkOptions): Promise<IngestMemoryWorkspaceResult>` | Applies the private-label firewall before delegating to generic ingest. | function | exported | [line 25](../../src/benchmark/composition/ingest-evidence-benchmark.ts#L25) |
## `src/benchmark/data-paths.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `evidenceBenchmarkDataPaths(dataDir: string): EvidenceBenchmarkDataPaths` | Filesystem layout shared by evidence-based benchmark adapters. | function | exported | [line 12](../../src/benchmark/data-paths.ts#L12) |
## `src/benchmark/index.ts`

_No top-level functions, classes, or class methods._
## `src/benchmark/label-firewall.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `normalizedKey(key: string): string` | Normalizes d key. | function | internal | [line 21](../../src/benchmark/label-firewall.ts#L21) |
| `assertNoPrivateLabels(value: unknown, path: string): void` | Validates no private labels and throws when invalid. | function | internal | [line 25](../../src/benchmark/label-firewall.ts#L25) |
| `assertBenchmarkLabelFirewall(sessions: readonly MemorySessionInput[]): void` | Benchmark ingress firewall. | function | exported | [line 45](../../src/benchmark/label-firewall.ts#L45) |
## `src/benchmark/longmemeval/data-paths.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `dataPaths(dataDir: string): LongMemEvalDataPaths` | Derives all persistent LongMemEval paths from one data directory. | function | exported | [line 9](../../src/benchmark/longmemeval/data-paths.ts#L9) |
## `src/benchmark/longmemeval/dataset-adapter.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `renderAnswerMemory(memory: PiMemResult["evidence"][number]): string` | Renders answer memory. | function | internal | [line 55](../../src/benchmark/longmemeval/dataset-adapter.ts#L55) |
| `buildLongMemEvalAnswerPrompt(question: string, retrieval: PiMemResult): BenchmarkAnswerPrompt` | Builds long mem eval answer prompt. | function | exported | [line 62](../../src/benchmark/longmemeval/dataset-adapter.ts#L62) |
| `objectAt(value: unknown, path: string): JsonObject` | Implements the object at operation. | function | internal | [line 116](../../src/benchmark/longmemeval/dataset-adapter.ts#L116) |
| `arrayAt(value: unknown, path: string): unknown[]` | Implements the array at operation. | function | internal | [line 123](../../src/benchmark/longmemeval/dataset-adapter.ts#L123) |
| `identifierAt(value: unknown, path: string): string` | Implements the identifier at operation. | function | internal | [line 130](../../src/benchmark/longmemeval/dataset-adapter.ts#L130) |
| `sourceTextAt(value: unknown, path: string): string` | Implements the source text at operation. | function | internal | [line 137](../../src/benchmark/longmemeval/dataset-adapter.ts#L137) |
| `rawStringAt(value: unknown, path: string): string` | Implements the raw string at operation. | function | internal | [line 144](../../src/benchmark/longmemeval/dataset-adapter.ts#L144) |
| `optionalSourceText(value: unknown, path: string): string \| undefined` | Implements the optional source text operation. | function | internal | [line 151](../../src/benchmark/longmemeval/dataset-adapter.ts#L151) |
| `timestampParts(raw: string, path: string): { year: number; month: number; day: number; hour: number; minute: number; }` | Implements the timestamp parts operation. | function | internal | [line 158](../../src/benchmark/longmemeval/dataset-adapter.ts#L158) |
| `twoDigits(value: number): string` | Implements the two digits operation. | function | internal | [line 190](../../src/benchmark/longmemeval/dataset-adapter.ts#L190) |
| `normalizeLongMemEvalTimestamp(raw: string, path = "timestamp"): string` | LongMemEval timestamps carry no timezone. | function | exported | [line 198](../../src/benchmark/longmemeval/dataset-adapter.ts#L198) |
| `longMemEvalScopeId(questionId: string): string` | Implements the long mem eval scope id operation. | function | exported | [line 206](../../src/benchmark/longmemeval/dataset-adapter.ts#L206) |
| `longMemEvalSessionId(scopeId: string, sourceSessionId: string): string` | Implements the long mem eval session id operation. | function | exported | [line 211](../../src/benchmark/longmemeval/dataset-adapter.ts#L211) |
| `longMemEvalMemoryId(scopeId: string, sourceDiaId: string): string` | Implements the long mem eval memory id operation. | function | exported | [line 220](../../src/benchmark/longmemeval/dataset-adapter.ts#L220) |
| `roleFor(speaker: string, speakerA: string, speakerB: string): MemoryRole` | Implements the role for operation. | function | internal | [line 229](../../src/benchmark/longmemeval/dataset-adapter.ts#L229) |
| `numericSessionIndex(key: string): number` | Implements the numeric session index operation. | function | internal | [line 249](../../src/benchmark/longmemeval/dataset-adapter.ts#L249) |
| `adaptLongMemEvalS(raw: unknown): LongMemEvalAdapterResult` | Trusted benchmark boundary. | function | exported | [line 260](../../src/benchmark/longmemeval/dataset-adapter.ts#L260) |
| `loadLongMemEvalS(path: string): Promise<LongMemEvalAdapterResult>` | Loads long mem eval s. | function | exported | [line 418](../../src/benchmark/longmemeval/dataset-adapter.ts#L418) |
## `src/benchmark/longmemeval/private-question-store.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `readPrivateQuestions(path: string): Promise<LongMemEvalPrivateQuestion[]>` | Reads private questions. | function | exported | [line 11](../../src/benchmark/longmemeval/private-question-store.ts#L11) |
| `mergePrivateQuestions(path: string, incoming: readonly LongMemEvalPrivateQuestion[]): Promise<void>` | Merges private questions. | function | exported | [line 33](../../src/benchmark/longmemeval/private-question-store.ts#L33) |
## `src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `chunkHash(chunk: string): string` | Implements the chunk hash operation. | function | internal | [line 22](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L22) |
| `nonNegativeInteger(value: unknown, path: string): number` | Implements the non negative integer operation. | function | internal | [line 26](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L26) |
| `stringValue(value: unknown, path: string): string` | Implements the string value operation. | function | internal | [line 37](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L37) |
| `cloneState(state: MemoryArenaGenerationState): MemoryArenaGenerationState` | Implements the clone state operation. | function | internal | [line 42](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L42) |
| `cloneUsers(users: Map<string, MemoryArenaGenerationState>): Map<string, MemoryArenaGenerationState>` | Implements the clone users operation. | function | internal | [line 51](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L51) |
| `parseState(value: unknown): Map<string, MemoryArenaGenerationState>` | Parses state. | function | internal | [line 59](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L59) |
| `FileMemoryArenaGenerationStore` | Durable active-generation sidecar. | class | exported | [line 124](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L124) |
| `FileMemoryArenaGenerationStore.constructor(readonly path: string)` | Creates a file memory arena generation store instance. | method | public | [line 128](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L128) |
| `FileMemoryArenaGenerationStore.initialize(userId: string, memorySystemName: string): Promise<MemoryArenaGenerationState>` | Implements the initialize operation. | method | public | [line 130](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L130) |
| `FileMemoryArenaGenerationStore.get(userId: string): Promise<MemoryArenaGenerationState \| undefined>` | Implements the get operation. | method | public | [line 154](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L154) |
| `FileMemoryArenaGenerationStore.reserveAppend(options: { userId: string; generation: number; chunk: string; }): Promise<number>` | Implements the reserve append operation. | method | public | [line 161](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L161) |
| `FileMemoryArenaGenerationStore.completeAppend(options: { userId: string; generation: number; ordinal: number; chunk: string; }): Promise<MemoryArenaGenerationState>` | Implements the complete append operation. | method | public | [line 190](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L190) |
| `FileMemoryArenaGenerationStore.active(users: Map<string, MemoryArenaGenerationState>, userId: string, generation: number): MemoryArenaGenerationState` | Implements the active operation. | method | private | [line 218](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L218) |
| `FileMemoryArenaGenerationStore.load(): Promise<Map<string, MemoryArenaGenerationState>>` | Loads the requested resource. | method | private | [line 237](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L237) |
| `FileMemoryArenaGenerationStore.persist(users: Map<string, MemoryArenaGenerationState>): Promise<void>` | Implements the persist operation. | method | private | [line 251](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L251) |
| `FileMemoryArenaGenerationStore.locked(operation: () => Promise<T>): Promise<T>` | Implements the locked operation. | method | private | [line 270](../../src/benchmark/memoryarena-public/adapters/filesystem-generation-store.ts#L270) |
## `src/benchmark/memoryarena-public/adapters/jsonl-operation-audit-sink.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `embeddingMetrics(metrics: MemoryArenaEmbeddingMetrics): Record<string, number>` | Implements the embedding metrics operation. | function | internal | [line 19](../../src/benchmark/memoryarena-public/adapters/jsonl-operation-audit-sink.ts#L19) |
| `embeddingAudit(audit: MemoryArenaOperationEmbeddingAudit): Record<string, unknown>` | Implements the embedding audit operation. | function | internal | [line 30](../../src/benchmark/memoryarena-public/adapters/jsonl-operation-audit-sink.ts#L30) |
| `artifactUnavailable(cause: unknown): MemoryArenaPublicError` | Implements the artifact unavailable operation. | function | internal | [line 39](../../src/benchmark/memoryarena-public/adapters/jsonl-operation-audit-sink.ts#L39) |
| `JsonlMemoryArenaOperationAuditSink` | Durable, privacy-safe lifecycle log for the official initialize/add/wrap API. | class | exported | [line 55](../../src/benchmark/memoryarena-public/adapters/jsonl-operation-audit-sink.ts#L55) |
| `JsonlMemoryArenaOperationAuditSink.constructor(readonly path: string)` | Creates a jsonl memory arena operation audit sink instance. | method | public | [line 59](../../src/benchmark/memoryarena-public/adapters/jsonl-operation-audit-sink.ts#L59) |
| `JsonlMemoryArenaOperationAuditSink.begin(record: MemoryArenaOperationAuditStart): Promise<MemoryArenaOperationAuditSpan>` | Implements the begin operation. | method | public | [line 61](../../src/benchmark/memoryarena-public/adapters/jsonl-operation-audit-sink.ts#L61) |
| `JsonlMemoryArenaOperationAuditSink.flush(): Promise<void>` | Implements the flush operation. | method | public | [line 151](../../src/benchmark/memoryarena-public/adapters/jsonl-operation-audit-sink.ts#L151) |
| `JsonlMemoryArenaOperationAuditSink.append(record: Record<string, unknown>): Promise<void>` | Implements the append operation. | method | private | [line 155](../../src/benchmark/memoryarena-public/adapters/jsonl-operation-audit-sink.ts#L155) |
## `src/benchmark/memoryarena-public/adapters/jsonl-wrap-audit-sink.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `JsonlMemoryArenaWrapAuditSink` | Implements jsonl memory arena wrap audit sink. | class | exported | [line 10](../../src/benchmark/memoryarena-public/adapters/jsonl-wrap-audit-sink.ts#L10) |
| `JsonlMemoryArenaWrapAuditSink.constructor(readonly path: string)` | Creates a jsonl memory arena wrap audit sink instance. | method | public | [line 13](../../src/benchmark/memoryarena-public/adapters/jsonl-wrap-audit-sink.ts#L13) |
| `JsonlMemoryArenaWrapAuditSink.record(record: MemoryArenaWrapAuditRecord): Promise<void>` | Implements the record operation. | method | public | [line 15](../../src/benchmark/memoryarena-public/adapters/jsonl-wrap-audit-sink.ts#L15) |
| `JsonlMemoryArenaWrapAuditSink.flush(): Promise<void>` | Implements the flush operation. | method | public | [line 43](../../src/benchmark/memoryarena-public/adapters/jsonl-wrap-audit-sink.ts#L43) |
| `NoopMemoryArenaWrapAuditSink` | Implements noop memory arena wrap audit sink. | class | exported | [line 48](../../src/benchmark/memoryarena-public/adapters/jsonl-wrap-audit-sink.ts#L48) |
| `NoopMemoryArenaWrapAuditSink.record(_record: MemoryArenaWrapAuditRecord): Promise<void>` | Implements the record operation. | method | public | [line 49](../../src/benchmark/memoryarena-public/adapters/jsonl-wrap-audit-sink.ts#L49) |
## `src/benchmark/memoryarena-public/adapters/measured-embedder.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `zeroAccumulator(): OperationAccumulator` | Implements the zero accumulator operation. | function | internal | [line 30](../../src/benchmark/memoryarena-public/adapters/measured-embedder.ts#L30) |
| `embeddingAudit(accumulator: OperationAccumulator): MemoryArenaOperationEmbeddingAudit` | Implements the embedding audit operation. | function | internal | [line 40](../../src/benchmark/memoryarena-public/adapters/measured-embedder.ts#L40) |
| `attachEmbeddingDiagnostics(error: unknown, embedding: MemoryArenaOperationEmbeddingAudit): Error` | Implements the attach embedding diagnostics operation. | function | internal | [line 54](../../src/benchmark/memoryarena-public/adapters/measured-embedder.ts#L54) |
| `MemoryArenaMeasuredEmbedder` | Routes exact provider-attempt metrics through async context to the add/wrap operation that initiated each call. | class | exported | [line 81](../../src/benchmark/memoryarena-public/adapters/measured-embedder.ts#L81) |
| `MemoryArenaMeasuredEmbedder.constructor(private readonly delegate: MemoryArenaAttemptMeteredEmbedder)` | Creates a memory arena measured embedder instance. | method | public | [line 91](../../src/benchmark/memoryarena-public/adapters/measured-embedder.ts#L91) |
| `MemoryArenaMeasuredEmbedder.measureOperation(operation: () => Promise<T>): Promise<{ result: T; embedding: MemoryArenaOperationEmbeddingAudit; }>` | Implements the measure operation operation. | method | public | [line 99](../../src/benchmark/memoryarena-public/adapters/measured-embedder.ts#L99) |
| `MemoryArenaMeasuredEmbedder.embedDocuments(texts: readonly string[], options: EmbeddingRequestOptions = {}): Promise<number[][]>` | Implements the embed documents operation. | method | public | [line 117](../../src/benchmark/memoryarena-public/adapters/measured-embedder.ts#L117) |
| `MemoryArenaMeasuredEmbedder.embedQueries(texts: readonly string[], options: EmbeddingRequestOptions = {}): Promise<number[][]>` | Implements the embed queries operation. | method | public | [line 124](../../src/benchmark/memoryarena-public/adapters/measured-embedder.ts#L124) |
| `MemoryArenaMeasuredEmbedder.snapshotMetrics(): EmbeddingMetrics` | Implements the snapshot metrics operation. | method | public | [line 131](../../src/benchmark/memoryarena-public/adapters/measured-embedder.ts#L131) |
| `MemoryArenaMeasuredEmbedder.measuredCall(operation: () => Promise<T>): Promise<T>` | Implements the measured call operation. | method | private | [line 135](../../src/benchmark/memoryarena-public/adapters/measured-embedder.ts#L135) |
## `src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `memoryArenaPublicScopeId(userId: string, generation: number): string` | Implements the memory arena public scope id operation. | function | exported | [line 42](../../src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.ts#L42) |
| `appendRequestIdentity(options: { userId: string; generation: number; ordinal: number; chunk: string; }): { requestId: string; requestHash: string; sourceSessionId: string }` | Implements the append request identity operation. | function | internal | [line 49](../../src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.ts#L49) |
| `memoryArenaRetryableUpstreamError(error: unknown): boolean` | Implements the memory arena retryable upstream error operation. | function | exported | [line 70](../../src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.ts#L70) |
| `memoryArenaUpstreamAuthStatus(error: unknown): 401 \| 403 \| undefined` | Implements the memory arena upstream auth status operation. | function | exported | [line 77](../../src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.ts#L77) |
| `mapUpstreamError(error: unknown, operation: string): never` | Implements the map upstream error operation. | function | internal | [line 94](../../src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.ts#L94) |
| `PiMemMemoryArenaAdapter` | Maps the official memory backend lifecycle onto immutable PiMem source chunks. | class | exported | [line 128](../../src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.ts#L128) |
| `PiMemMemoryArenaAdapter.constructor(private readonly options: PiMemMemoryArenaAdapterOptions)` | Creates a pi mem memory arena adapter instance. | method | public | [line 132](../../src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.ts#L132) |
| `PiMemMemoryArenaAdapter.appendOriginalChunk(options: { userId: string; generation: number; ordinal: number; chunk: string; }): Promise<void>` | Implements the append original chunk operation. | method | public | [line 136](../../src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.ts#L136) |
| `PiMemMemoryArenaAdapter.readOriginalChunks(options: { userId: string; generation: number; memoryIds: readonly string[]; }): Promise<MemoryArenaOriginalChunk[]>` | Reads original chunks. | method | public | [line 180](../../src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.ts#L180) |
| `PiMemMemoryArenaAdapter.retrieve(options: { userId: string; generation: number; question: string; }): Promise<MemoryArenaRetrievalResult>` | Implements the retrieve operation. | method | public | [line 191](../../src/benchmark/memoryarena-public/adapters/pimem-memory-runtime.ts#L191) |
## `src/benchmark/memoryarena-public/composition/create-runtime.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `fileErrorCode(error: unknown): string \| undefined` | Implements the file error code operation. | function | internal | [line 74](../../src/benchmark/memoryarena-public/composition/create-runtime.ts#L74) |
| `processIsAlive(pid: number): boolean` | Implements the process is alive operation. | function | internal | [line 80](../../src/benchmark/memoryarena-public/composition/create-runtime.ts#L80) |
| `acquireMemoryArenaPublicDataDirectoryLease(dataDir: string): Promise<MemoryArenaPublicDataDirectoryLease>` | Prevents independent server processes from corrupting one generation sidecar. | function | exported | [line 90](../../src/benchmark/memoryarena-public/composition/create-runtime.ts#L90) |
| `createMemoryArenaPublicRuntime(options: CreateMemoryArenaPublicRuntimeOptions): Promise<MemoryArenaPublicRuntime>` | Wires the official HTTP memory contract to PiMem without benchmark policy. | function | exported | [line 158](../../src/benchmark/memoryarena-public/composition/create-runtime.ts#L158) |
## `src/benchmark/memoryarena-public/index.ts`

_No top-level functions, classes, or class methods._
## `src/benchmark/memoryarena-public/model/memory-backend.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `MemoryArenaPublicError` | Implements memory arena public error. | class | exported | [line 166](../../src/benchmark/memoryarena-public/model/memory-backend.ts#L166) |
| `MemoryArenaPublicError.constructor(options: { code: MemoryArenaErrorCode; message: string; httpStatus: number; retryable?: boolean; cause?: unknown; diagnostics?: MemoryArenaOperationErrorDiagnostics; })` | Creates a memory arena public error instance. | method | public | [line 172](../../src/benchmark/memoryarena-public/model/memory-backend.ts#L172) |
| `MemoryArenaOperationDiagnosticError` | Preserves operation diagnostics without changing an internal error into HTTP policy. | class | exported | [line 192](../../src/benchmark/memoryarena-public/model/memory-backend.ts#L192) |
| `MemoryArenaOperationDiagnosticError.constructor(options: { message: string; cause: unknown; diagnostics: MemoryArenaOperationErrorDiagnostics; })` | Creates a memory arena operation diagnostic error instance. | method | public | [line 195](../../src/benchmark/memoryarena-public/model/memory-backend.ts#L195) |
| `userNotInitialized(): MemoryArenaPublicError` | Implements the user not initialized operation. | function | exported | [line 206](../../src/benchmark/memoryarena-public/model/memory-backend.ts#L206) |
| `memorySystemMismatch(): MemoryArenaPublicError` | Implements the memory system mismatch operation. | function | exported | [line 214](../../src/benchmark/memoryarena-public/model/memory-backend.ts#L214) |
| `unsupportedMemorySystem(name: string): MemoryArenaPublicError` | Implements the unsupported memory system operation. | function | exported | [line 222](../../src/benchmark/memoryarena-public/model/memory-backend.ts#L222) |
## `src/benchmark/memoryarena-public/ports/memory-backend.ts`

_No top-level functions, classes, or class methods._
## `src/benchmark/memoryarena-public/use-cases/memory-backend.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `sha256(value: string): string` | Implements the sha256 operation. | function | internal | [line 27](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L27) |
| `recordValue(value: unknown): Record<string, unknown> \| undefined` | Implements the record value operation. | function | internal | [line 31](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L31) |
| `finiteNumber(record: Record<string, unknown>, key: string): number \| undefined` | Implements the finite number operation. | function | internal | [line 37](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L37) |
| `safeCount(record: Record<string, unknown>, key: string): number \| undefined` | Implements the safe count operation. | function | internal | [line 47](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L47) |
| `modelUsage(value: unknown): MemoryArenaOperationFailedRetrieval["usage"] \| undefined` | Implements the model usage operation. | function | internal | [line 57](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L57) |
| `piMemFailureDiagnostics(error: unknown): MemoryArenaOperationFailedRetrieval \| undefined` | Implements the pi mem failure diagnostics operation. | function | internal | [line 100](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L100) |
| `operationFailure(error: unknown): MemoryArenaOperationAuditFailure` | Implements the operation failure operation. | function | internal | [line 163](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L163) |
| `operationEmbeddingDiagnostics(error: unknown): MemoryArenaOperationEmbeddingAudit \| undefined` | Implements the operation embedding diagnostics operation. | function | internal | [line 184](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L184) |
| `operationAuditUnavailable(error: unknown, embedding?: MemoryArenaOperationEmbeddingAudit): MemoryArenaPublicError` | Implements the operation audit unavailable operation. | function | internal | [line 205](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L205) |
| `cloneRetrieval(retrieval: MemoryArenaRetrievalResult): MemoryArenaRetrievalResult` | Implements the clone retrieval operation. | function | internal | [line 226](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L226) |
| `selectedMemoryIds(retrieval: MemoryArenaRetrievalResult): string[]` | Implements the selected memory ids operation. | function | internal | [line 251](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L251) |
| `renderMemoryArenaPublicPrompt(question: string, chunks: readonly string[]): string` | Renders memory arena public prompt. | function | exported | [line 260](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L260) |
| `MemoryArenaPublicMemoryBackend` | Implements memory arena public memory backend. | class | exported | [line 274](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L274) |
| `MemoryArenaPublicMemoryBackend.constructor(private readonly dependencies: MemoryArenaPublicBackendDependencies)` | Creates a memory arena public memory backend instance. | method | public | [line 275](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L275) |
| `MemoryArenaPublicMemoryBackend.initialize(input: MemoryArenaInitializeInput): Promise<MemoryArenaInitializeResult>` | Implements the initialize operation. | method | public | [line 281](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L281) |
| `MemoryArenaPublicMemoryBackend.add(input: MemoryArenaAddInput): Promise<MemoryArenaAddResult>` | Implements the add operation. | method | public | [line 305](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L305) |
| `MemoryArenaPublicMemoryBackend.wrap(input: MemoryArenaWrapInput): Promise<MemoryArenaWrapResult>` | Implements the wrap operation. | method | public | [line 341](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L341) |
| `MemoryArenaPublicMemoryBackend.audited(start: MemoryArenaOperationAuditStart, operation: () => Promise<{ result: T; audit: MemoryArenaOperationAuditSuccess; }>): Promise<T>` | Implements the audited operation. | method | private | [line 436](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L436) |
| `MemoryArenaPublicMemoryBackend.assertSupportedSystem(memorySystemName: string): void` | Validates supported system and throws when invalid. | method | private | [line 489](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L489) |
| `MemoryArenaPublicMemoryBackend.activeState(input: MemoryArenaInitializeInput): Promise<MemoryArenaGenerationState>` | Implements the active state operation. | method | private | [line 495](../../src/benchmark/memoryarena-public/use-cases/memory-backend.ts#L495) |
## `src/benchmark/model/benchmark-query.ts`

_No top-level functions, classes, or class methods._
## `src/benchmark/model/benchmark-run.ts`

_No top-level functions, classes, or class methods._
## `src/benchmark/model/evidence-benchmark-run.ts`

_No top-level functions, classes, or class methods._
## `src/benchmark/private-question-store.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `readPrivateBenchmarkQuestions(path: string): Promise<T[]>` | Reads private benchmark questions. | function | exported | [line 14](../../src/benchmark/private-question-store.ts#L14) |
| `mergePrivateBenchmarkQuestions(path: string, incoming: readonly T[]): Promise<void>` | Atomically merges private benchmark labels by question identity. | function | exported | [line 42](../../src/benchmark/private-question-store.ts#L42) |
## `src/benchmark/tau-knowledge/data-paths.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `tauKnowledgeDataPaths(root: string): TauKnowledgeDataPaths` | Implements the tau knowledge data paths operation. | function | exported | [line 10](../../src/benchmark/tau-knowledge/data-paths.ts#L10) |
## `src/benchmark/tau-knowledge/dataset-adapter.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `objectAt(value: unknown, path: string): JsonObject` | Implements the object at operation. | function | internal | [line 47](../../src/benchmark/tau-knowledge/dataset-adapter.ts#L47) |
| `sourceTextAt(value: unknown, path: string): string` | Implements the source text at operation. | function | internal | [line 54](../../src/benchmark/tau-knowledge/dataset-adapter.ts#L54) |
| `safeDocumentId(value: unknown, path: string): string` | Implements the safe document id operation. | function | internal | [line 61](../../src/benchmark/tau-knowledge/dataset-adapter.ts#L61) |
| `parseTauKnowledgeDocument(value: unknown, path = "document"): TauKnowledgeDocument` | Parses tau knowledge document. | function | exported | [line 69](../../src/benchmark/tau-knowledge/dataset-adapter.ts#L69) |
| `adaptTauKnowledgeDocuments(documents: readonly TauKnowledgeDocument[]): MemorySessionInput[]` | Trusted ingest firewall. | function | exported | [line 85](../../src/benchmark/tau-knowledge/dataset-adapter.ts#L85) |
| `portableRelative(root: string, path: string): string` | Implements the portable relative operation. | function | internal | [line 115](../../src/benchmark/tau-knowledge/dataset-adapter.ts#L115) |
| `hashTauKnowledgeFiles(domainRoot: string, paths: readonly string[]): Promise<string>` | Hashes path and bytes in lexical path order; filenames are part of identity. | function | exported | [line 120](../../src/benchmark/tau-knowledge/dataset-adapter.ts#L120) |
| `jsonFiles(directory: string, pattern: RegExp): Promise<string[]>` | Implements the json files operation. | function | internal | [line 134](../../src/benchmark/tau-knowledge/dataset-adapter.ts#L134) |
| `loadPinnedTauKnowledgeCheckout(tauRoot: string): Promise<TauKnowledgeDataset>` | Loads pinned tau knowledge checkout. | function | exported | [line 141](../../src/benchmark/tau-knowledge/dataset-adapter.ts#L141) |
## `src/benchmark/tau-knowledge/index.ts`

_No top-level functions, classes, or class methods._
## `src/cli.ts`

_No top-level functions, classes, or class methods._
## `src/composition/create-read-only-navigation.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createReadOnlyScopeNavigation(scopeRoot: string, scopeId: string): ReadOnlyNavigationBinding` | Creates read only scope navigation. | function | exported | [line 6](../../src/composition/create-read-only-navigation.ts#L6) |
## `src/composition/create-retrieval-context.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createRetrievalContext(rawStore: MemoryStore, profile: RetrievalProfile, embedder?: Embedder): RetrievalContext` | Creates retrieval context. | function | exported | [line 20](../../src/composition/create-retrieval-context.ts#L20) |
## `src/composition/create-search-operator-registry.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createSearchOperatorRegistry(store: SearchOperatorStore, additionalOperators: readonly SearchOperator[] = []): SearchOperatorRegistry` | Registers built-in and additional operators, then freezes the catalog. | function | exported | [line 9](../../src/composition/create-search-operator-registry.ts#L9) |
| `createSelectedSearchOperatorRegistry(store: SearchOperatorStore, builtInOperatorIds: readonly string[], additionalOperators: readonly SearchOperator[] = []): SearchOperatorRegistry` | Registers an explicit allowlist of built-in and additional operators for one run. | function | exported | [line 28](../../src/composition/create-search-operator-registry.ts#L28) |
## `src/composition/ingest-memory-workspace.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `ingestMemoryWorkspace(options: IngestMemoryWorkspaceOptions): Promise<IngestMemoryWorkspaceResult>` | Wires immutable session ingest to SQLite and optional embeddings. | function | exported | [line 36](../../src/composition/ingest-memory-workspace.ts#L36) |
## `src/composition/load-search-operator-plugins.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `pluginModule(value: unknown, path: string): SearchOperatorPluginModule` | Implements the plugin module operation. | function | internal | [line 20](../../src/composition/load-search-operator-plugins.ts#L20) |
| `loadSearchOperatorPlugins(paths: readonly string[], store: SearchOperatorStore): Promise<LoadedSearchOperatorPlugins>` | Loads trusted local modules once at composition time and fingerprints them. | function | exported | [line 34](../../src/composition/load-search-operator-plugins.ts#L34) |
## `src/composition/run-question.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `runQuestion(paths: PiMemWorkspacePaths, retrievalProfile: RetrievalProfile, scopeId: string, question: string, questionDate: string \| undefined, modelOptions: LoadPiModelRuntimeOptions, skill: PiMemSkill = "pimem-v0"): Promise<PiMemResult>` | Runs question. | function | exported | [line 20](../../src/composition/run-question.ts#L20) |
## `src/entrypoints/cli/commands/benchmark-evidence.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `datasetRetrievalProfile(manifest: DatasetManifest): "fts5" \| "pimem-hybrid"` | Implements the dataset retrieval profile operation. | function | internal | [line 82](../../src/entrypoints/cli/commands/benchmark-evidence.ts#L82) |
| `benchmarkFor(parsed: ParsedCommand): EvidenceBenchmarkId` | Implements the benchmark for operation. | function | internal | [line 99](../../src/entrypoints/cli/commands/benchmark-evidence.ts#L99) |
| `selectQueries(queries: readonly RunnableQuery[], requestedIds: ReadonlySet<string>): RunnableQuery[]` | Implements the select queries operation. | function | internal | [line 107](../../src/entrypoints/cli/commands/benchmark-evidence.ts#L107) |
| `recordPath(directory: string, caseId: string): string` | Implements the record path operation. | function | internal | [line 125](../../src/entrypoints/cli/commands/benchmark-evidence.ts#L125) |
| `directoryHasRecords(directory: string): Promise<boolean>` | Implements the directory has records operation. | function | internal | [line 129](../../src/entrypoints/cli/commands/benchmark-evidence.ts#L129) |
| `loadSuccessRecordIds(directory: string, benchmark: EvidenceBenchmarkId, queries: readonly RunnableQuery[]): Promise<Set<string>>` | Loads success record ids. | function | internal | [line 140](../../src/entrypoints/cli/commands/benchmark-evidence.ts#L140) |
| `materializeArtifacts(options: { outputDir: string; benchmark: EvidenceBenchmarkId; queries: readonly RunnableQuery[]; }): Promise<{ succeeded: number; failed: number }>` | Materializes artifacts. | function | internal | [line 162](../../src/entrypoints/cli/commands/benchmark-evidence.ts#L162) |
| `predictionFor(options: { benchmark: EvidenceBenchmarkId; query: RunnableQuery; retrieval: PiMemResult; answer: Awaited<ReturnType<typeof runBenchmarkAnswer>>; }): EvidenceBenchmarkPrediction` | Implements the prediction for operation. | function | internal | [line 222](../../src/entrypoints/cli/commands/benchmark-evidence.ts#L222) |
| `answerPromptFor(_benchmark: EvidenceBenchmarkId, query: RunnableQuery, retrieval: PiMemResult)` | Implements the answer prompt for operation. | function | internal | [line 248](../../src/entrypoints/cli/commands/benchmark-evidence.ts#L248) |
| `modelFlagsForRun(): string[]` | Implements the model flags for run operation. | function | internal | [line 256](../../src/entrypoints/cli/commands/benchmark-evidence.ts#L256) |
| `benchmarkEvidence(parsed: ParsedCommand): Promise<void>` | Implements the benchmark evidence operation. | function | exported | [line 265](../../src/entrypoints/cli/commands/benchmark-evidence.ts#L265) |
## `src/entrypoints/cli/commands/benchmark-longmemeval.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `successRecordPath(recordsDir: string, questionId: string): string` | Implements the success record path operation. | function | internal | [line 68](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L68) |
| `failureRecordPath(failuresDir: string, questionId: string): string` | Implements the failure record path operation. | function | internal | [line 72](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L72) |
| `completedQuestionIds(path: string): Promise<Set<string>>` | Implements the completed question ids operation. | function | internal | [line 76](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L76) |
| `predictionFor(retrieval: PiMemResult, answer: BenchmarkAnswerResult, questionId: string): BenchmarkPrediction` | Implements the prediction for operation. | function | internal | [line 94](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L94) |
| `loadSuccessRecords(recordsDir: string, questions: readonly LongMemEvalPrivateQuestion[]): Promise<Map<string, BenchmarkSuccessRecord>>` | Loads success records. | function | internal | [line 122](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L122) |
| `readJsonlMap(path: string): Promise<Map<string, unknown>>` | Reads jsonl map. | function | internal | [line 143](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L143) |
| `materializeBenchmarkArtifacts(outputDir: string, selected: readonly LongMemEvalPrivateQuestion[]): Promise<{ succeeded: number; failed: number }>` | Materializes benchmark artifacts. | function | internal | [line 163](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L163) |
| `systemicRuntimeFailure(message: string): boolean` | Implements the systemic runtime failure operation. | function | internal | [line 234](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L234) |
| `benchmarkLongMemEval(parsed: ParsedCommand): Promise<void>` | Implements the benchmark long mem eval operation. | function | exported | [line 240](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L240) |
## `src/entrypoints/cli/commands/evaluate-benchmark.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `benchmarkFor(parsed: ParsedCommand): EvidenceBenchmarkId` | Implements the benchmark for operation. | function | internal | [line 47](../../src/entrypoints/cli/commands/evaluate-benchmark.ts#L47) |
| `judgeFlags(): string[]` | Implements the judge flags operation. | function | internal | [line 55](../../src/entrypoints/cli/commands/evaluate-benchmark.ts#L55) |
| `readPredictions(path: string, benchmark: EvidenceBenchmarkId): Promise<EvidenceBenchmarkPrediction[]>` | Reads predictions. | function | internal | [line 62](../../src/entrypoints/cli/commands/evaluate-benchmark.ts#L62) |
| `indexedByQuestionId(values: readonly T[], label: string): Map<string, T>` | Indexes ed by question id. | function | internal | [line 102](../../src/entrypoints/cli/commands/evaluate-benchmark.ts#L102) |
| `validatePredictionScope(prediction: EvidenceBenchmarkPrediction, expectedScopeId: string): void` | Validates prediction scope. | function | internal | [line 147](../../src/entrypoints/cli/commands/evaluate-benchmark.ts#L147) |
| `pathExists(path: string): Promise<boolean>` | Implements the path exists operation. | function | internal | [line 159](../../src/entrypoints/cli/commands/evaluate-benchmark.ts#L159) |
| `directoryHasRecords(path: string): Promise<boolean>` | Implements the directory has records operation. | function | internal | [line 171](../../src/entrypoints/cli/commands/evaluate-benchmark.ts#L171) |
| `assertPredictionModelMatchesRun(prediction: EvidenceBenchmarkPrediction, sourceRun: SourceRunManifest): void` | Validates prediction model matches run and throws when invalid. | function | internal | [line 182](../../src/entrypoints/cli/commands/evaluate-benchmark.ts#L182) |
| `evaluationProvenance(options: { benchmark: EvidenceBenchmarkId; dataPaths: ReturnType<typeof evidenceBenchmarkDataPaths>; predictionsPath: string; predictions: readonly EvidenceBenchmarkPrediction[]; selectedQueries: readonly unknown[]; selectedLabels: readonly unknown[]; }): Promise<EvaluationProvenance>` | Implements the evaluation provenance operation. | function | internal | [line 205](../../src/entrypoints/cli/commands/evaluate-benchmark.ts#L205) |
| `judgeRecordPath(directory: string, questionId: string): string` | Implements the judge record path operation. | function | internal | [line 269](../../src/entrypoints/cli/commands/evaluate-benchmark.ts#L269) |
| `evaluateBenchmark(parsed: ParsedCommand): Promise<void>` | Implements the evaluate benchmark operation. | function | exported | [line 273](../../src/entrypoints/cli/commands/evaluate-benchmark.ts#L273) |
## `src/entrypoints/cli/commands/ingest-benchmark.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `benchmarkFor(parsed: ParsedCommand): EvidenceBenchmarkId` | Implements the benchmark for operation. | function | internal | [line 49](../../src/entrypoints/cli/commands/ingest-benchmark.ts#L49) |
| `selectCases(values: readonly T[], requestedIds: ReadonlySet<string>): T[]` | Implements the select cases operation. | function | internal | [line 57](../../src/entrypoints/cli/commands/ingest-benchmark.ts#L57) |
| `loadAmaSelection(parsed: ParsedCommand, requestedIds: ReadonlySet<string>): Promise<AdaptedSelection>` | Loads ama selection. | function | internal | [line 73](../../src/entrypoints/cli/commands/ingest-benchmark.ts#L73) |
| `writeDatasetManifest(options: { path: string; identity: DatasetIdentity; dataPaths: EvidenceBenchmarkDataPaths; retrieval: unknown; }): Promise<number>` | Writes dataset manifest. | function | internal | [line 99](../../src/entrypoints/cli/commands/ingest-benchmark.ts#L99) |
| `assertDatasetIdentity(path: string, identity: DatasetIdentity): Promise<StoredDatasetManifest \| undefined>` | Validates dataset identity and throws when invalid. | function | internal | [line 117](../../src/entrypoints/cli/commands/ingest-benchmark.ts#L117) |
| `withDataDirectoryLock(databasePath: string, action: () => Promise<T>): Promise<T>` | Implements the with data directory lock operation. | function | internal | [line 132](../../src/entrypoints/cli/commands/ingest-benchmark.ts#L132) |
| `ingestBenchmark(parsed: ParsedCommand): Promise<void>` | Implements the ingest benchmark operation. | function | exported | [line 154](../../src/entrypoints/cli/commands/ingest-benchmark.ts#L154) |
## `src/entrypoints/cli/commands/ingest-longmemeval.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `ingestLongMemEval(parsed: ParsedCommand): Promise<void>` | Implements the ingest long mem eval operation. | function | exported | [line 26](../../src/entrypoints/cli/commands/ingest-longmemeval.ts#L26) |
## `src/entrypoints/cli/commands/ingest-tau-knowledge.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `withDataDirectoryLock(root: string, action: () => Promise<T>): Promise<T>` | Implements the with data directory lock operation. | function | internal | [line 33](../../src/entrypoints/cli/commands/ingest-tau-knowledge.ts#L33) |
| `ingestTauKnowledge(parsed: ParsedCommand): Promise<void>` | Implements the ingest tau knowledge operation. | function | exported | [line 54](../../src/entrypoints/cli/commands/ingest-tau-knowledge.ts#L54) |
## `src/entrypoints/cli/commands/longmemeval-suite.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `sleep(milliseconds: number): Promise<void>` | Implements the sleep operation. | function | internal | [line 39](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L39) |
| `jsonRecordCount(directory: string): Promise<number>` | Implements the json record count operation. | function | internal | [line 45](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L45) |
| `runLoggedChild(options: { file: string; args: string[]; environment: NodeJS.ProcessEnv; logPath: string; mirrorStderr?: boolean; }): Promise<number>` | Runs logged child. | function | internal | [line 61](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L61) |
| `unresolvedFailureMessages(outputDir: string): Promise<string[]>` | Implements the unresolved failure messages operation. | function | internal | [line 101](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L101) |
| `auditLongMemEvalSuite(outputDir: string, expected: number): Promise<Record<string, unknown>>` | Implements the audit long mem eval suite operation. | function | internal | [line 124](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L124) |
| `baselineScores(parsed: ParsedCommand): Array<{ name: string; accuracy: number; }>` | Implements the baseline scores operation. | function | internal | [line 214](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L214) |
| `packageEvaluationArtifacts(outputDir: string, archivePath: string): Promise<void>` | Packages evaluation artifacts. | function | internal | [line 232](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L232) |
| `roleFlag(parsed: ParsedCommand, role: SuiteModelRole, name: string): string \| undefined` | Implements the role flag operation. | function | internal | [line 307](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L307) |
| `requiredRoleFlag(parsed: ParsedCommand, role: SuiteModelRole, name: string): string` | Implements the required role flag operation. | function | internal | [line 315](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L315) |
| `modelRoleConfiguration(parsed: ParsedCommand, role: SuiteModelRole): SuiteModelRoleConfiguration` | Implements the model role configuration operation. | function | internal | [line 329](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L329) |
| `suiteModelConfigurationFor(parsed: ParsedCommand): SuiteModelConfiguration` | Implements the suite model configuration for operation. | function | exported | [line 358](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L358) |
| `suiteRoleRuntimeArguments(role: SuiteModelRole, configuration: SuiteModelRoleConfiguration, apiKeyEnvironment: string, baseUrlEnvironment: string): string[]` | Implements the suite role runtime arguments operation. | function | internal | [line 367](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L367) |
| `suiteBenchmarkEnvironment(options: { retrievalSource: NodeJS.ProcessEnv; answerSource: NodeJS.ProcessEnv; models: SuiteModelConfiguration; }): NodeJS.ProcessEnv` | Implements the suite benchmark environment operation. | function | exported | [line 406](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L406) |
| `longMemEvalSuite(parsed: ParsedCommand): Promise<void>` | Implements the long mem eval suite operation. | function | exported | [line 443](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L443) |
## `src/entrypoints/cli/commands/package-benchmark.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `jsonlRecordCount(serialized: string): number` | Implements the jsonl record count operation. | function | internal | [line 14](../../src/entrypoints/cli/commands/package-benchmark.ts#L14) |
| `packageBenchmark(parsed: ParsedCommand): Promise<void>` | Packages benchmark. | function | exported | [line 18](../../src/entrypoints/cli/commands/package-benchmark.ts#L18) |
## `src/entrypoints/cli/commands/prepare-longmemeval-eval.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `prepareLongMemEvalEvaluation(parsed: ParsedCommand): Promise<void>` | Prepares long mem eval evaluation. | function | exported | [line 9](../../src/entrypoints/cli/commands/prepare-longmemeval-eval.ts#L9) |
## `src/entrypoints/cli/commands/run-longmemeval.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `runLongMemEval(parsed: ParsedCommand): Promise<void>` | Runs long mem eval. | function | exported | [line 20](../../src/entrypoints/cli/commands/run-longmemeval.ts#L20) |
## `src/entrypoints/cli/commands/run-memory.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `runGeneric(parsed: ParsedCommand): Promise<void>` | Runs generic. | function | exported | [line 14](../../src/entrypoints/cli/commands/run-memory.ts#L14) |
## `src/entrypoints/cli/evidence-benchmark-runtime.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `benchmarkModelOptionsFor(parsed: ParsedCommand, role: BenchmarkModelRole): LoadPiModelRuntimeOptions` | Resolves one role's model flags with field-wise unprefixed fallbacks. | function | exported | [line 46](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L46) |
| `benchmarkRuntimeIdentity(runtime: PiModelRuntime): BenchmarkRuntimeIdentity` | Implements the benchmark runtime identity operation. | function | exported | [line 69](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L69) |
| `benchmarkSystemicRuntimeFailure(message: string): boolean` | Stops queue refill for explicit provider-wide failures without matching IDs. | function | exported | [line 87](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L87) |
| `compareText(left: string, right: string): number` | Compares text. | function | internal | [line 93](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L93) |
| `canonicalJson(value: unknown, path = "$", ancestors = new Set<object>()): string` | Checks whether onical json. | function | internal | [line 99](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L99) |
| `benchmarkQuerySetHash(queries: readonly unknown[]): string` | Hashes the complete selected query records without depending on input order. | function | exported | [line 154](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L154) |
| `benchmarkSelectedCorpusHash(sanitizedRoot: string, selections: readonly BenchmarkScopeSelection[]): Promise<string>` | Hashes only the sanitized memory files selected by the current query set. | function | exported | [line 168](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L168) |
| `benchmarkSourceRevision(): BenchmarkSourceRevision` | Implements the benchmark source revision operation. | function | exported | [line 199](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L199) |
| `errorCode(error: unknown): string \| undefined` | Implements the error code operation. | function | internal | [line 292](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L292) |
| `validateManifest(value: unknown): BenchmarkRunManifest` | Validates manifest. | function | internal | [line 299](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L299) |
| `createManifestIfAbsent(path: string, manifest: BenchmarkRunManifest): Promise<boolean>` | Creates manifest if absent. | function | internal | [line 325](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L325) |
| `ensureBenchmarkRunManifest(path: string, config: Readonly<Record<string, unknown>>): Promise<BenchmarkRunManifest>` | Creates a run manifest once, or validates an existing resumable run. | function | exported | [line 361](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L361) |
| `withoutTopLevelKeys(config: Readonly<Record<string, unknown>>, omitted: ReadonlySet<string>): Record<string, unknown>` | Implements the without top level keys operation. | function | internal | [line 411](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L411) |
| `migrateBenchmarkRunInfrastructure(path: string, config: Readonly<Record<string, unknown>>, allowedConfigChanges: readonly string[]): Promise<BenchmarkRunManifest>` | Transparently migrates an existing run across infrastructure-only changes. | function | exported | [line 428](../../src/entrypoints/cli/evidence-benchmark-runtime.ts#L428) |
## `src/entrypoints/cli/main.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `printHelp(): void` | Implements the print help operation. | function | internal | [line 15](../../src/entrypoints/cli/main.ts#L15) |
| `main(): Promise<void>` | Implements the main operation. | function | internal | [line 33](../../src/entrypoints/cli/main.ts#L33) |
## `src/entrypoints/cli/parse-command.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `parseCommand(argv: string[]): ParsedCommand` | Parses command. | function | exported | [line 26](../../src/entrypoints/cli/parse-command.ts#L26) |
| `requiredFlag(parsed: ParsedCommand, name: string): string` | Implements the required flag operation. | function | exported | [line 48](../../src/entrypoints/cli/parse-command.ts#L48) |
| `optionalFlag(parsed: ParsedCommand, name: string): string \| undefined` | Implements the optional flag operation. | function | exported | [line 56](../../src/entrypoints/cli/parse-command.ts#L56) |
| `positiveIntegerFlag(parsed: ParsedCommand, name: string, fallback: number, maximum: number): number` | Implements the positive integer flag operation. | function | exported | [line 68](../../src/entrypoints/cli/parse-command.ts#L68) |
| `positiveNumberFlag(parsed: ParsedCommand, name: string, fallback: number, maximum: number): number` | Implements the positive number flag operation. | function | exported | [line 83](../../src/entrypoints/cli/parse-command.ts#L83) |
| `modelOptionsFor(parsed: ParsedCommand): LoadPiModelRuntimeOptions` | Implements the model options for operation. | function | exported | [line 98](../../src/entrypoints/cli/parse-command.ts#L98) |
| `skillFor(parsed: ParsedCommand): PiMemSkill` | Implements the skill for operation. | function | exported | [line 177](../../src/entrypoints/cli/parse-command.ts#L177) |
| `assertOnlyFlags(parsed: ParsedCommand, allowed: readonly string[]): void` | Validates only flags and throws when invalid. | function | exported | [line 185](../../src/entrypoints/cli/parse-command.ts#L185) |
| `retrievalProfileFor(parsed: ParsedCommand): RetrievalProfile` | Implements the retrieval profile for operation. | function | exported | [line 195](../../src/entrypoints/cli/parse-command.ts#L195) |
## `src/entrypoints/cli/workflow-files.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `writeAtomicText(path: string, serialized: string): Promise<void>` | Writes a file through a permission-restricted temporary file and atomic rename. | function | exported | [line 15](../../src/entrypoints/cli/workflow-files.ts#L15) |
| `writeAtomicJson(path: string, value: unknown): Promise<void>` | Serializes a value as formatted JSON and writes it atomically. | function | exported | [line 29](../../src/entrypoints/cli/workflow-files.ts#L29) |
| `createAtomicTextFile(path: string): Promise<AtomicTextFile>` | Opens a restricted temporary file for bounded-memory artifact materialization. | function | exported | [line 43](../../src/entrypoints/cli/workflow-files.ts#L43) |
| `readJsonFileIfPresent(path: string): Promise<T \| undefined>` | Reads a JSON file, returning undefined only when the file is absent. | function | exported | [line 85](../../src/entrypoints/cli/workflow-files.ts#L85) |
| `executeArchiveCommand(file: string, args: string[]): Promise<void>` | Executes a command used to create an archive and normalizes its error. | function | exported | [line 99](../../src/entrypoints/cli/workflow-files.ts#L99) |
## `src/entrypoints/ldbd-api/contracts.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `LdbdContractError` | Implements ldbd contract error. | class | exported | [line 21](../../src/entrypoints/ldbd-api/contracts.ts#L21) |
| `LdbdContractError.constructor(message: string)` | Creates a ldbd contract error instance. | method | public | [line 22](../../src/entrypoints/ldbd-api/contracts.ts#L22) |
| `objectValue(value: unknown, label: string): Record<string, unknown>` | Implements the object value operation. | function | internal | [line 28](../../src/entrypoints/ldbd-api/contracts.ts#L28) |
| `exactFields(value: Record<string, unknown>, allowed: readonly string[], label: string): void` | Implements the exact fields operation. | function | internal | [line 35](../../src/entrypoints/ldbd-api/contracts.ts#L35) |
| `identifier(value: unknown, label: string): string` | Implements the identifier operation. | function | internal | [line 47](../../src/entrypoints/ldbd-api/contracts.ts#L47) |
| `text(value: unknown, label: string, maximum: number): string` | Implements the text operation. | function | internal | [line 55](../../src/entrypoints/ldbd-api/contracts.ts#L55) |
| `parseAddRequest(value: unknown): LdbdAddRequest` | Validates one synchronous LDBD Add request and keeps only the memory contract fields. | function | exported | [line 65](../../src/entrypoints/ldbd-api/contracts.ts#L65) |
| `parseSearchRequest(value: unknown): LdbdSearchRequest` | Validates one LDBD Search request with a bounded top-k and optional choices. | function | exported | [line 100](../../src/entrypoints/ldbd-api/contracts.ts#L100) |
| `renderRetrievalQuestion(request: LdbdSearchRequest): string` | Adds benchmark options to the retrieval question without persisting them as memory. | function | exported | [line 128](../../src/entrypoints/ldbd-api/contracts.ts#L128) |
## `src/entrypoints/ldbd-api/main.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `requiredEnvironment(name: string): string` | Implements the required environment operation. | function | internal | [line 19](../../src/entrypoints/ldbd-api/main.ts#L19) |
| `integerEnvironment(name: string, fallback: number): number` | Implements the integer environment operation. | function | internal | [line 25](../../src/entrypoints/ldbd-api/main.ts#L25) |
| `tokenDigest(value: string): Buffer` | Converts ken digest. | function | internal | [line 35](../../src/entrypoints/ldbd-api/main.ts#L35) |
| `authorized(request: IncomingMessage, expectedToken: string \| undefined): boolean` | Implements the authorized operation. | function | internal | [line 39](../../src/entrypoints/ldbd-api/main.ts#L39) |
| `jsonBody(request: IncomingMessage): Promise<unknown>` | Implements the json body operation. | function | internal | [line 48](../../src/entrypoints/ldbd-api/main.ts#L48) |
| `respond(response: ServerResponse, status: number, body: unknown): void` | Implements the respond operation. | function | internal | [line 65](../../src/entrypoints/ldbd-api/main.ts#L65) |
| `shutdown(): void` | Implements the shutdown operation. | function | internal | [line 130](../../src/entrypoints/ldbd-api/main.ts#L130) |
## `src/entrypoints/ldbd-api/pimem-runtime.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `KeyedSerialExecutor` | Implements keyed serial executor. | class | internal | [line 26](../../src/entrypoints/ldbd-api/pimem-runtime.ts#L26) |
| `KeyedSerialExecutor.run(key: string, operation: () => Promise<T>): Promise<T>` | Runs the operation. | method | public | [line 29](../../src/entrypoints/ldbd-api/pimem-runtime.ts#L29) |
| `requestHash(request: LdbdAddRequest): string` | Implements the request hash operation. | function | internal | [line 45](../../src/entrypoints/ldbd-api/pimem-runtime.ts#L45) |
| `timestamp(value: number \| undefined): string \| undefined` | Implements the timestamp operation. | function | internal | [line 49](../../src/entrypoints/ldbd-api/pimem-runtime.ts#L49) |
| `PiMemLdbdApplication` | Implements pi mem ldbd application. | class | exported | [line 58](../../src/entrypoints/ldbd-api/pimem-runtime.ts#L58) |
| `PiMemLdbdApplication.constructor(private readonly store: MemoryStore & OnlineMemoryStore, private readonly embedder: Embedder, private readonly modelRuntime: PiModelRuntime)` | Creates a pi mem ldbd application instance. | method | public | [line 61](../../src/entrypoints/ldbd-api/pimem-runtime.ts#L61) |
| `PiMemLdbdApplication.add(request: LdbdAddRequest): Promise<"inserted" \| "unchanged">` | Implements the add operation. | method | public | [line 67](../../src/entrypoints/ldbd-api/pimem-runtime.ts#L67) |
| `PiMemLdbdApplication.search(request: LdbdSearchRequest, _signal?: AbortSignal): Promise<LdbdSearchItem[]>` | Performs a search. | method | public | [line 104](../../src/entrypoints/ldbd-api/pimem-runtime.ts#L104) |
## `src/entrypoints/ldbd-api/service.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `LdbdConflictError` | Implements ldbd conflict error. | class | exported | [line 21](../../src/entrypoints/ldbd-api/service.ts#L21) |
| `LdbdConflictError.constructor(message: string)` | Creates a ldbd conflict error instance. | method | public | [line 22](../../src/entrypoints/ldbd-api/service.ts#L22) |
| `LdbdUnavailableError` | Implements ldbd unavailable error. | class | exported | [line 28](../../src/entrypoints/ldbd-api/service.ts#L28) |
| `LdbdUnavailableError.constructor(message: string)` | Creates a ldbd unavailable error instance. | method | public | [line 29](../../src/entrypoints/ldbd-api/service.ts#L29) |
| `onlineScopeId(userId: string): string` | Implements the online scope id operation. | function | exported | [line 35](../../src/entrypoints/ldbd-api/service.ts#L35) |
| `LdbdApiService` | Implements ldbd api service. | class | exported | [line 39](../../src/entrypoints/ldbd-api/service.ts#L39) |
| `LdbdApiService.constructor(private readonly application: LdbdMemoryApplication)` | Creates a ldbd api service instance. | method | public | [line 40](../../src/entrypoints/ldbd-api/service.ts#L40) |
| `LdbdApiService.add(value: unknown): Promise<Record<string, unknown>>` | Handles the synchronous LDBD Add operation. | method | public | [line 42](../../src/entrypoints/ldbd-api/service.ts#L42) |
| `LdbdApiService.search(value: unknown, signal?: AbortSignal): Promise<{ data: LdbdSearchItem[] }>` | Handles the LDBD Search operation through the injected search engine. | method | public | [line 54](../../src/entrypoints/ldbd-api/service.ts#L54) |
## `src/entrypoints/memoryarena-public-api/application.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `KeyedSerialExecutor` | Implements keyed serial executor. | class | internal | [line 23](../../src/entrypoints/memoryarena-public-api/application.ts#L23) |
| `KeyedSerialExecutor.run(key: string, operation: () => Promise<T>): Promise<T>` | Runs the operation. | method | public | [line 26](../../src/entrypoints/memoryarena-public-api/application.ts#L26) |
| `MemoryArenaPublicApplication` | Serializes one user's lifecycle while allowing independent users to overlap. | class | exported | [line 43](../../src/entrypoints/memoryarena-public-api/application.ts#L43) |
| `MemoryArenaPublicApplication.constructor(private readonly backend: MemoryArenaPublicBackend)` | Creates a memory arena public application instance. | method | public | [line 46](../../src/entrypoints/memoryarena-public-api/application.ts#L46) |
| `MemoryArenaPublicApplication.initialize(input: MemoryArenaInitializeInput): Promise<MemoryArenaInitializeResult>` | Implements the initialize operation. | method | public | [line 48](../../src/entrypoints/memoryarena-public-api/application.ts#L48) |
| `MemoryArenaPublicApplication.add(input: MemoryArenaAddInput): Promise<MemoryArenaAddResult>` | Implements the add operation. | method | public | [line 54](../../src/entrypoints/memoryarena-public-api/application.ts#L54) |
| `MemoryArenaPublicApplication.wrap(input: MemoryArenaWrapInput): Promise<MemoryArenaWrapResult>` | Implements the wrap operation. | method | public | [line 58](../../src/entrypoints/memoryarena-public-api/application.ts#L58) |
| `MemoryArenaPublicApiService` | Implements memory arena public api service. | class | exported | [line 63](../../src/entrypoints/memoryarena-public-api/application.ts#L63) |
| `MemoryArenaPublicApiService.constructor(private readonly application: MemoryArenaPublicApplication)` | Creates a memory arena public api service instance. | method | public | [line 64](../../src/entrypoints/memoryarena-public-api/application.ts#L64) |
| `MemoryArenaPublicApiService.initialize(value: unknown): Promise<Record<string, unknown>>` | Implements the initialize operation. | method | public | [line 66](../../src/entrypoints/memoryarena-public-api/application.ts#L66) |
| `MemoryArenaPublicApiService.add(value: unknown): Promise<Record<string, unknown>>` | Implements the add operation. | method | public | [line 76](../../src/entrypoints/memoryarena-public-api/application.ts#L76) |
| `MemoryArenaPublicApiService.wrap(value: unknown): Promise<Record<string, unknown>>` | Implements the wrap operation. | method | public | [line 86](../../src/entrypoints/memoryarena-public-api/application.ts#L86) |
## `src/entrypoints/memoryarena-public-api/contracts.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `objectValue(value: unknown, label: string): Record<string, unknown>` | Implements the object value operation. | function | internal | [line 8](../../src/entrypoints/memoryarena-public-api/contracts.ts#L8) |
| `contractError(message: string): MemoryArenaPublicError` | Implements the contract error operation. | function | internal | [line 15](../../src/entrypoints/memoryarena-public-api/contracts.ts#L15) |
| `exactFields(record: Record<string, unknown>, allowed: readonly string[], label: string): void` | Implements the exact fields operation. | function | internal | [line 23](../../src/entrypoints/memoryarena-public-api/contracts.ts#L23) |
| `stringField(record: Record<string, unknown>, field: string, label: string): string` | Implements the string field operation. | function | internal | [line 37](../../src/entrypoints/memoryarena-public-api/contracts.ts#L37) |
| `parseMemoryArenaInitializeRequest(value: unknown): MemoryArenaInitializeInput` | Parses memory arena initialize request. | function | exported | [line 49](../../src/entrypoints/memoryarena-public-api/contracts.ts#L49) |
| `parseMemoryArenaAddRequest(value: unknown): MemoryArenaAddInput` | Parses memory arena add request. | function | exported | [line 64](../../src/entrypoints/memoryarena-public-api/contracts.ts#L64) |
| `parseMemoryArenaWrapRequest(value: unknown): MemoryArenaWrapInput` | Parses memory arena wrap request. | function | exported | [line 78](../../src/entrypoints/memoryarena-public-api/contracts.ts#L78) |
## `src/entrypoints/memoryarena-public-api/main.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `requiredEnvironment(name: string): string` | Implements the required environment operation. | function | internal | [line 20](../../src/entrypoints/memoryarena-public-api/main.ts#L20) |
| `integerEnvironment(name: string, fallback: number, maximum: number): number` | Implements the integer environment operation. | function | internal | [line 26](../../src/entrypoints/memoryarena-public-api/main.ts#L26) |
| `thinkingLevelEnvironment(): NonNullable< LoadPiModelRuntimeOptions["thinkingLevel"] >` | Implements the thinking level environment operation. | function | internal | [line 40](../../src/entrypoints/memoryarena-public-api/main.ts#L40) |
| `jsonBody(request: IncomingMessage): Promise<unknown>` | Implements the json body operation. | function | internal | [line 58](../../src/entrypoints/memoryarena-public-api/main.ts#L58) |
| `respond(response: ServerResponse, status: number, body: unknown, retryable = false): void` | Implements the respond operation. | function | internal | [line 91](../../src/entrypoints/memoryarena-public-api/main.ts#L91) |
| `main(): Promise<void>` | Implements the main operation. | function | internal | [line 107](../../src/entrypoints/memoryarena-public-api/main.ts#L107) |
## `src/entrypoints/tau-knowledge-bridge/main.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `objectAt(value: unknown, path: string): Record<string, unknown>` | Implements the object at operation. | function | internal | [line 62](../../src/entrypoints/tau-knowledge-bridge/main.ts#L62) |
| `initializeRequest(value: unknown): InitializeRequest` | Implements the initialize request operation. | function | internal | [line 69](../../src/entrypoints/tau-knowledge-bridge/main.ts#L69) |
| `agentInput(value: unknown): InteractiveAgentInput` | Implements the agent input operation. | function | internal | [line 115](../../src/entrypoints/tau-knowledge-bridge/main.ts#L115) |
| `skillForBridge(raw: string \| undefined): InteractiveMemorySkill` | Implements the skill for bridge operation. | function | internal | [line 148](../../src/entrypoints/tau-knowledge-bridge/main.ts#L148) |
| `output(value: unknown): void` | Implements the output operation. | function | internal | [line 156](../../src/entrypoints/tau-knowledge-bridge/main.ts#L156) |
| `main(): Promise<void>` | Implements the main operation. | function | internal | [line 160](../../src/entrypoints/tau-knowledge-bridge/main.ts#L160) |
## `src/evidence-agent/adapters/docker/read-only-shell.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `buildBashRoDockerArgs(scopePath: string, command: string, image = DEFAULT_IMAGE, containerUser = "0:0"): string[]` | Builds bash ro docker args. | function | exported | [line 21](../../src/evidence-agent/adapters/docker/read-only-shell.ts#L21) |
| `ReadOnlyBash` | Runs a shell inside a disposable, networkless container with exactly one sanitized memory scope mounted read-only. | class | exported | [line 62](../../src/evidence-agent/adapters/docker/read-only-shell.ts#L62) |
| `ReadOnlyBash.constructor(options: BashRoOptions = {})` | Creates a read only bash instance. | method | public | [line 69](../../src/evidence-agent/adapters/docker/read-only-shell.ts#L69) |
| `ReadOnlyBash.run(scopePath: string, command: string, signal?: AbortSignal): Promise<BashRoResult>` | Runs the operation. | method | public | [line 82](../../src/evidence-agent/adapters/docker/read-only-shell.ts#L82) |
## `src/evidence-agent/adapters/pi/assistant-messages.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `lastAssistantMessage(messages: readonly unknown[]): AssistantMessage \| undefined` | Implements the last assistant message operation. | function | exported | [line 4](../../src/evidence-agent/adapters/pi/assistant-messages.ts#L4) |
| `assistantMessageText(message: AssistantMessage \| undefined, maxChars?: number): string` | Implements the assistant message text operation. | function | exported | [line 21](../../src/evidence-agent/adapters/pi/assistant-messages.ts#L21) |
| `responseModelMatches(requested: string, actual: string): boolean` | Implements the response model matches operation. | function | internal | [line 38](../../src/evidence-agent/adapters/pi/assistant-messages.ts#L38) |
| `validateResponseModels(messages: readonly unknown[], requestedModel: string): string[]` | Validates response models. | function | exported | [line 42](../../src/evidence-agent/adapters/pi/assistant-messages.ts#L42) |
| `aggregateAssistantUsage(messages: readonly unknown[]): ModelUsage` | Implements the aggregate assistant usage operation. | function | exported | [line 67](../../src/evidence-agent/adapters/pi/assistant-messages.ts#L67) |
## `src/evidence-agent/adapters/pi/ephemeral-context.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `isToolResult(message: AgentMessage): message is ToolResultMessage` | Checks whether tool result. | function | internal | [line 16](../../src/evidence-agent/adapters/pi/ephemeral-context.ts#L16) |
| `trailingToolResultStart(messages: readonly AgentMessage[]): number` | Implements the trailing tool result start operation. | function | internal | [line 20](../../src/evidence-agent/adapters/pi/ephemeral-context.ts#L20) |
| `createEphemeralMemoryContext(): EphemeralMemoryContext` | Keeps the current tool batch visible once, then expires navigation payloads. | function | exported | [line 31](../../src/evidence-agent/adapters/pi/ephemeral-context.ts#L31) |
## `src/evidence-agent/adapters/pi/retrieval-prompt.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `activeSkillPrompt(): string` | Implements the active skill prompt operation. | function | internal | [line 41](../../src/evidence-agent/adapters/pi/retrieval-prompt.ts#L41) |
| `piMemSystemPrompt(skill: PiMemSkill = "pimem-v0", basePrompt: string = PI_MEM_BASE_SYSTEM_PROMPT, operatorCatalog: readonly SearchOperatorCatalogEntry[] = []): string` | Implements the pi mem system prompt operation. | function | exported | [line 45](../../src/evidence-agent/adapters/pi/retrieval-prompt.ts#L45) |
## `src/evidence-agent/adapters/pi/tools.ts`

_No top-level functions, classes, or class methods._
## `src/evidence-agent/adapters/pi/tools/bash-tool.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createBashRoTool(options: CreatePiMemToolsOptions & { bashRo: NonNullable<CreatePiMemToolsOptions["bashRo"]>; }): AgentTool<typeof BashRoParameters, BashRoToolDetails>` | Creates bash ro tool. | function | exported | [line 8](../../src/evidence-agent/adapters/pi/tools/bash-tool.ts#L8) |
## `src/evidence-agent/adapters/pi/tools/candidate-refs.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `normalizeHarnessRefs(refs: readonly number[]): number[]` | Normalizes harness refs. | function | exported | [line 1](../../src/evidence-agent/adapters/pi/tools/candidate-refs.ts#L1) |
## `src/evidence-agent/adapters/pi/tools/contracts.ts`

_No top-level functions, classes, or class methods._
## `src/evidence-agent/adapters/pi/tools/create-tools.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createPiMemTools(options: CreatePiMemToolsOptions): PiMemTools` | Creates pi mem tools. | function | exported | [line 8](../../src/evidence-agent/adapters/pi/tools/create-tools.ts#L8) |
## `src/evidence-agent/adapters/pi/tools/define-operator-tool.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createDefineOperatorTool(options: CreatePiMemToolsOptions & { operatorDefinitions: NonNullable<CreatePiMemToolsOptions["operatorDefinitions"]>; }): NonNullable<PiMemTools["defineOperator"]>` | Creates the compact Agent tool that assembles existing operators into one run-local operator. | function | exported | [line 7](../../src/evidence-agent/adapters/pi/tools/define-operator-tool.ts#L7) |
## `src/evidence-agent/adapters/pi/tools/finish-tool.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createFinishTool(options: CreatePiMemToolsOptions): PiMemTools["finish"]` | Creates finish tool. | function | exported | [line 6](../../src/evidence-agent/adapters/pi/tools/finish-tool.ts#L6) |
## `src/evidence-agent/adapters/pi/tools/read-tool.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createReadTool(options: CreatePiMemToolsOptions): PiMemTools["read"]` | Creates read tool. | function | exported | [line 7](../../src/evidence-agent/adapters/pi/tools/read-tool.ts#L7) |
## `src/evidence-agent/adapters/pi/tools/render-tool-result.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `temporalSuffix(timestamp: string \| undefined, questionDate: string \| undefined): string` | Implements the temporal suffix operation. | function | internal | [line 9](../../src/evidence-agent/adapters/pi/tools/render-tool-result.ts#L9) |
| `renderEvidenceOperator(result: EvidenceOperatorResult \| undefined, ledger: MemoryLedger): string` | Renders evidence operator. | function | exported | [line 17](../../src/evidence-agent/adapters/pi/tools/render-tool-result.ts#L17) |
| `renderCandidates(candidates: readonly MemoryCandidate[], ledger: MemoryLedger, questionDate?: string): string` | Renders candidates. | function | exported | [line 67](../../src/evidence-agent/adapters/pi/tools/render-tool-result.ts#L67) |
| `renderMemories(memories: readonly MemoryEvidence[], ledger: MemoryLedger, questionDate?: string): string` | Renders memories. | function | exported | [line 89](../../src/evidence-agent/adapters/pi/tools/render-tool-result.ts#L89) |
## `src/evidence-agent/adapters/pi/tools/schemas.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createSearchParameters(operatorIds: readonly string[])` | Creates search parameters. | function | exported | [line 3](../../src/evidence-agent/adapters/pi/tools/schemas.ts#L3) |
## `src/evidence-agent/adapters/pi/tools/search-tool.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createSearchTool(options: CreatePiMemToolsOptions): PiMemTools["search"]` | Creates the Pi search tool that delegates retrieval and records returned candidates in the ledger. | function | exported | [line 9](../../src/evidence-agent/adapters/pi/tools/search-tool.ts#L9) |
## `src/evidence-agent/adapters/pi/tools/tool-protocol.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `validateFinishToolBatch(toolNames: readonly string[], finishToolName = "finish"): string \| undefined` | Validates finish tool batch. | function | exported | [line 7](../../src/evidence-agent/adapters/pi/tools/tool-protocol.ts#L7) |
| `createFinishOnlyBeforeToolCall(finishToolName = "finish"): ( context: BeforeToolCallContext, signal?: AbortSignal, ) => Promise<BeforeToolCallResult \| undefined>` | Creates finish only before tool call. | function | exported | [line 18](../../src/evidence-agent/adapters/pi/tools/tool-protocol.ts#L18) |
| `createToolProtocolBeforeToolCall(options: { maxSearchCalls?: number; } = {}): ( context: BeforeToolCallContext, signal?: AbortSignal, ) => Promise<BeforeToolCallResult \| undefined>` | Creates tool protocol before tool call. | function | exported | [line 53](../../src/evidence-agent/adapters/pi/tools/tool-protocol.ts#L53) |
## `src/evidence-agent/index.ts`

_No top-level functions, classes, or class methods._
## `src/evidence-agent/model/evidence.ts`

_No top-level functions, classes, or class methods._
## `src/evidence-agent/model/memory-evidence.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `cloneMetadata(metadata: Record<string, unknown>): Record<string, unknown>` | Implements the clone metadata operation. | function | internal | [line 45](../../src/evidence-agent/model/memory-evidence.ts#L45) |
| `asciiLower(value: string): string` | Implements the ascii lower operation. | function | internal | [line 49](../../src/evidence-agent/model/memory-evidence.ts#L49) |
| `focusTerms(focus: readonly string[]): string[]` | Implements the focus terms operation. | function | internal | [line 53](../../src/evidence-agent/model/memory-evidence.ts#L53) |
| `mergeSpans(spans: readonly { start: number; end: number }[]): Array<{ start: number; end: number }>` | Merges spans. | function | internal | [line 62](../../src/evidence-agent/model/memory-evidence.ts#L62) |
| `focusedSpans(content: string, focus: readonly string[], budget: number): Array<{ start: number; end: number }>` | Implements the focused spans operation. | function | internal | [line 80](../../src/evidence-agent/model/memory-evidence.ts#L80) |
| `renderEvidenceExcerpts(options: { sourceContentLength: number; excerpts: readonly EvidenceExcerpt[]; }): string` | Renders evidence excerpts. | function | exported | [line 147](../../src/evidence-agent/model/memory-evidence.ts#L147) |
| `projectMemoryEvidence(record: MemoryRecord, focus: readonly string[], maximumChars: number): MemoryEvidence` | Implements the project memory evidence operation. | function | exported | [line 162](../../src/evidence-agent/model/memory-evidence.ts#L162) |
| `projectMemoryEvidenceBatch(records: readonly MemoryRecord[], focusFor: (record: MemoryRecord) => readonly string[]): MemoryEvidence[]` | Implements the project memory evidence batch operation. | function | exported | [line 196](../../src/evidence-agent/model/memory-evidence.ts#L196) |
## `src/evidence-agent/model/memory-ledger.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `cloneCandidate(candidate: MemoryCandidate): MemoryCandidate` | Implements the clone candidate operation. | function | internal | [line 14](../../src/evidence-agent/model/memory-ledger.ts#L14) |
| `cloneEvidence(evidence: MemoryEvidence): MemoryEvidence` | Implements the clone evidence operation. | function | internal | [line 23](../../src/evidence-agent/model/memory-ledger.ts#L23) |
| `cloneSelection(selection: PiMemSelection): PiMemSelection` | Implements the clone selection operation. | function | internal | [line 31](../../src/evidence-agent/model/memory-ledger.ts#L31) |
| `MemoryLedger` | Per-question, in-memory provenance ledger. | class | exported | [line 57](../../src/evidence-agent/model/memory-ledger.ts#L57) |
| `MemoryLedger.constructor(scopeId: string)` | Creates a memory ledger instance. | method | public | [line 69](../../src/evidence-agent/model/memory-ledger.ts#L69) |
| `MemoryLedger.nextStep(): number` | Implements the next step operation. | method | public | [line 77](../../src/evidence-agent/model/memory-ledger.ts#L77) |
| `MemoryLedger.hasRead(memoryId: string): boolean` | Checks whether read. | method | public | [line 107](../../src/evidence-agent/model/memory-ledger.ts#L107) |
| `MemoryLedger.candidateRef(memoryId: string): number \| undefined` | Checks whether didate ref. | method | public | [line 111](../../src/evidence-agent/model/memory-ledger.ts#L111) |
| `MemoryLedger.evidenceRef(memoryId: string): number \| undefined` | Implements the evidence ref operation. | method | public | [line 115](../../src/evidence-agent/model/memory-ledger.ts#L115) |
| `MemoryLedger.resolveCandidateRefs(refs: readonly number[]): string[]` | Resolves candidate refs. | method | public | [line 119](../../src/evidence-agent/model/memory-ledger.ts#L119) |
| `MemoryLedger.resolveEvidenceRef(ref: number): string` | Resolves evidence ref. | method | public | [line 132](../../src/evidence-agent/model/memory-ledger.ts#L132) |
| `MemoryLedger.selectCandidates(memoryIds: readonly string[]): MemoryCandidate[]` | Implements the select candidates operation. | method | public | [line 143](../../src/evidence-agent/model/memory-ledger.ts#L143) |
| `MemoryLedger.recordSearchHits(hits: readonly RetrievalHit[], step = this.nextStep()): MemoryCandidate[]` | Registers retrieval hits as candidates while preserving first-seen provenance. | method | public | [line 152](../../src/evidence-agent/model/memory-ledger.ts#L152) |
| `MemoryLedger.recordRead(evidenceRecords: readonly MemoryEvidence[], step = this.nextStep()): MemoryEvidence[]` | Registers bounded exact memory reads and promotes them to eligible evidence. | method | public | [line 178](../../src/evidence-agent/model/memory-ledger.ts#L178) |
| `MemoryLedger.recordBashDiscoveries(records: readonly MemoryRecord[], command: string, step = this.nextStep()): MemoryCandidate[]` | Implements the record bash discoveries operation. | method | public | [line 207](../../src/evidence-agent/model/memory-ledger.ts#L207) |
| `MemoryLedger.acceptSelection(input: PiMemSelection): PiMemSelection` | Validates and stores the agent's final evidence selection. | method | public | [line 225](../../src/evidence-agent/model/memory-ledger.ts#L225) |
| `MemoryLedger.assertInvariants(): void` | Verifies candidate, evidence, citation, and scope provenance invariants. | method | public | [line 322](../../src/evidence-agent/model/memory-ledger.ts#L322) |
| `MemoryLedger.assertScope(record: Pick<MemoryRecord, "scopeId" \| "memoryId">): void` | Validates scope and throws when invalid. | method | private | [line 347](../../src/evidence-agent/model/memory-ledger.ts#L347) |
| `MemoryLedger.upsertCandidate(record: Pick< MemoryRecord, "memoryId" \| "scopeId" \| "sessionId" \| "turnIndex" \| "role" \| "timestamp" >, preview: string, discovery: MemoryCandidate["discoveries"][number]): void` | Implements the upsert candidate operation. | method | private | [line 355](../../src/evidence-agent/model/memory-ledger.ts#L355) |
## `src/evidence-agent/ports/read-only-navigation.ts`

_No top-level functions, classes, or class methods._
## `src/evidence-agent/run-pimem.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `PiMemRunError` | Implements pi mem run error. | class | exported | [line 83](../../src/evidence-agent/run-pimem.ts#L83) |
| `PiMemRunError.constructor(message: string, diagnostics: PiMemFailureDiagnostics)` | Creates a pi mem run error instance. | method | public | [line 86](../../src/evidence-agent/run-pimem.ts#L86) |
| `questionPrompt(question: string, questionDate?: string): string` | Builds the user prompt from the question and optional question date. | function | internal | [line 93](../../src/evidence-agent/run-pimem.ts#L93) |
| `runPiMem(options: RunPiMemOptions): Promise<PiMemResult>` | Runs one bounded evidence-agent session and returns its provenance-backed result. | function | exported | [line 109](../../src/evidence-agent/run-pimem.ts#L109) |
## `src/memory/index.ts`

_No top-level functions, classes, or class methods._
## `src/memory/ingest-memory-sessions.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `assertSafeJson(value: unknown, path: string): void` | Validates safe json and throws when invalid. | function | internal | [line 31](../../src/memory/ingest-memory-sessions.ts#L31) |
| `cloneMetadata(value: Record<string, unknown> \| undefined, path: string): Record<string, unknown> \| undefined` | Implements the clone metadata operation. | function | internal | [line 58](../../src/memory/ingest-memory-sessions.ts#L58) |
| `validateTimestamp(value: string \| undefined, path: string): string \| undefined` | Validates timestamp. | function | internal | [line 70](../../src/memory/ingest-memory-sessions.ts#L70) |
| `recordsForScope(scopeId: string, sessions: readonly MemorySessionInput[]): MemoryRecord[]` | Implements the records for scope operation. | function | internal | [line 82](../../src/memory/ingest-memory-sessions.ts#L82) |
| `ingestMemorySessions(store: MemoryIngestStore, sessions: readonly MemorySessionInput[], options: IngestOptions = {}): Promise<IngestScopeResult[]>` | Deterministic, no-LLM ingest boundary. | function | exported | [line 167](../../src/memory/ingest-memory-sessions.ts#L167) |
## `src/memory/model/memory.ts`

_No top-level functions, classes, or class methods._
## `src/memory/ports/memory-ingest-store.ts`

_No top-level functions, classes, or class methods._
## `src/memoryarena-public-api.ts`

_No top-level functions, classes, or class methods._
## `src/platform/concurrency/async-pool.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `runAsyncPool(items: readonly T[], slots: number, worker: (item: T, context: AsyncPoolContext) => Promise<R>): Promise<R[]>` | Runs at most one item per slot and refills a slot as soon as it settles. | function | exported | [line 7](../../src/platform/concurrency/async-pool.ts#L7) |
## `src/platform/concurrency/request-gate.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `AsyncRequestGate` | Implements async request gate. | class | exported | [line 1](../../src/platform/concurrency/request-gate.ts#L1) |
| `AsyncRequestGate.constructor(maximumConcurrent: number, requestsPerSecond: number)` | Creates a async request gate instance. | method | public | [line 8](../../src/platform/concurrency/request-gate.ts#L8) |
| `AsyncRequestGate.run(operation: () => Promise<T>): Promise<T>` | Runs the operation. | method | public | [line 19](../../src/platform/concurrency/request-gate.ts#L19) |
| `AsyncRequestGate.acquire(): Promise<void>` | Implements the acquire operation. | method | private | [line 29](../../src/platform/concurrency/request-gate.ts#L29) |
| `AsyncRequestGate.release(): void` | Implements the release operation. | method | private | [line 37](../../src/platform/concurrency/request-gate.ts#L37) |
| `AsyncRequestGate.pace(): Promise<void>` | Implements the pace operation. | method | private | [line 46](../../src/platform/concurrency/request-gate.ts#L46) |
## `src/platform/filesystem/jsonl-writer.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `JsonlWriter` | Serializes large JSONL appends so concurrent workers cannot interleave lines. | class | exported | [line 4](../../src/platform/filesystem/jsonl-writer.ts#L4) |
| `JsonlWriter.append(path: string, value: unknown): Promise<void>` | Implements the append operation. | method | public | [line 7](../../src/platform/filesystem/jsonl-writer.ts#L7) |
| `JsonlWriter.flush(): Promise<void>` | Implements the flush operation. | method | public | [line 16](../../src/platform/filesystem/jsonl-writer.ts#L16) |
## `src/platform/pi/load-model-runtime.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `asObject(value: unknown, label: string): JsonObject` | Implements the as object operation. | function | internal | [line 76](../../src/platform/pi/load-model-runtime.ts#L76) |
| `asNonEmptyString(value: unknown, label: string): string` | Implements the as non empty string operation. | function | internal | [line 83](../../src/platform/pi/load-model-runtime.ts#L83) |
| `optionalBoolean(value: unknown, fallback: boolean, label: string): boolean` | Implements the optional boolean operation. | function | internal | [line 90](../../src/platform/pi/load-model-runtime.ts#L90) |
| `optionalPositiveInteger(value: unknown, fallback: number, label: string): number` | Implements the optional positive integer operation. | function | internal | [line 102](../../src/platform/pi/load-model-runtime.ts#L102) |
| `optionalCost(value: unknown, label: string): typeof DEFAULT_COST` | Implements the optional cost operation. | function | internal | [line 118](../../src/platform/pi/load-model-runtime.ts#L118) |
| `optionalInput(value: unknown, label: string): ("text" \| "image")[]` | Implements the optional input operation. | function | internal | [line 132](../../src/platform/pi/load-model-runtime.ts#L132) |
| `mergedCompat(providerValue: unknown, modelValue: unknown): JsonObject \| undefined` | Merges d compat. | function | internal | [line 144](../../src/platform/pi/load-model-runtime.ts#L144) |
| `optionalCompletionsCompat(raw: JsonObject \| undefined): OpenAICompletionsCompat \| undefined` | Implements the optional completions compat operation. | function | internal | [line 159](../../src/platform/pi/load-model-runtime.ts#L159) |
| `optionalResponsesCompat(raw: JsonObject \| undefined): OpenAIResponsesCompat \| undefined` | Implements the optional responses compat operation. | function | internal | [line 238](../../src/platform/pi/load-model-runtime.ts#L238) |
| `supportedApi(value: unknown, label: string): PiModelApi` | Implements the supported api operation. | function | internal | [line 276](../../src/platform/pi/load-model-runtime.ts#L276) |
| `validateBaseUrl(value: unknown): string` | Validates base url. | function | internal | [line 286](../../src/platform/pi/load-model-runtime.ts#L286) |
| `parseJsonFile(path: string, label: string): Promise<JsonObject>` | Parses json file. | function | internal | [line 306](../../src/platform/pi/load-model-runtime.ts#L306) |
| `trustedCommand(apiKeyConfig: unknown): string` | Implements the trusted command operation. | function | internal | [line 326](../../src/platform/pi/load-model-runtime.ts#L326) |
| `executeTrustedApiKeyCommand(command: string): Promise<string>` | Executes trusted api key command. | function | internal | [line 343](../../src/platform/pi/load-model-runtime.ts#L343) |
| `thinkingLevelFor(value: unknown, label: string): ThinkingLevel` | Implements the thinking level for operation. | function | internal | [line 370](../../src/platform/pi/load-model-runtime.ts#L370) |
| `validatedApiKeyEnvironmentName(value: unknown): string` | Validates d api key environment name. | function | internal | [line 380](../../src/platform/pi/load-model-runtime.ts#L380) |
| `environmentApiKeyResolver(providerId: string, environmentName: string): PiModelRuntime["getApiKey"]` | Implements the environment api key resolver operation. | function | internal | [line 388](../../src/platform/pi/load-model-runtime.ts#L388) |
| `streamFunctionFor(api: PiModelApi, transport: PiModelTransport): StreamFn` | Implements the stream function for operation. | function | internal | [line 402](../../src/platform/pi/load-model-runtime.ts#L402) |
| `loadAdaptedPiModelRuntime(options: LoadPiModelRuntimeOptions): PiModelRuntime` | Loads adapted pi model runtime. | function | internal | [line 418](../../src/platform/pi/load-model-runtime.ts#L418) |
| `loadPiModelRuntime(options: LoadPiModelRuntimeOptions = {}): Promise<PiModelRuntime>` | Loads pi model runtime. | function | exported | [line 493](../../src/platform/pi/load-model-runtime.ts#L493) |
## `src/platform/pi/model-runtime-adapter.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `PiModelRuntimeAdapterRegistry` | Implements pi model runtime adapter registry. | class | exported | [line 32](../../src/platform/pi/model-runtime-adapter.ts#L32) |
| `PiModelRuntimeAdapterRegistry.constructor(adapters: readonly PiModelRuntimeAdapter[] = [])` | Creates a pi model runtime adapter registry instance. | method | public | [line 35](../../src/platform/pi/model-runtime-adapter.ts#L35) |
| `PiModelRuntimeAdapterRegistry.register(adapter: PiModelRuntimeAdapter): void` | Implements the register operation. | method | public | [line 39](../../src/platform/pi/model-runtime-adapter.ts#L39) |
| `PiModelRuntimeAdapterRegistry.resolve(id: string): PiModelRuntimeAdapter` | Implements the resolve operation. | method | public | [line 48](../../src/platform/pi/model-runtime-adapter.ts#L48) |
| `PiModelRuntimeAdapterRegistry.list(): readonly PiModelRuntimeAdapter[]` | Implements the list operation. | method | public | [line 56](../../src/platform/pi/model-runtime-adapter.ts#L56) |
| `openAiCompletionsAdapter(): PiModelRuntimeAdapter` | Implements the open ai completions adapter operation. | function | internal | [line 68](../../src/platform/pi/model-runtime-adapter.ts#L68) |
| `openAiReasoningCompletionsAdapter(): PiModelRuntimeAdapter` | Implements the open ai reasoning completions adapter operation. | function | internal | [line 89](../../src/platform/pi/model-runtime-adapter.ts#L89) |
| `openAiResponsesAdapter(): PiModelRuntimeAdapter` | Implements the open ai responses adapter operation. | function | internal | [line 117](../../src/platform/pi/model-runtime-adapter.ts#L117) |
| `qwenCompletionsAdapter(): PiModelRuntimeAdapter` | Implements the qwen completions adapter operation. | function | internal | [line 142](../../src/platform/pi/model-runtime-adapter.ts#L142) |
| `createDefaultPiModelRuntimeAdapterRegistry(): PiModelRuntimeAdapterRegistry` | Creates default pi model runtime adapter registry. | function | exported | [line 177](../../src/platform/pi/model-runtime-adapter.ts#L177) |
## `src/platform/pi/openai-non-stream-transport.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `resolvedMessageCompat(model: Model<"openai-completions">): MessageCompat` | Resolves the OpenAI message-conversion compatibility settings for a model. | function | internal | [line 59](../../src/platform/pi/openai-non-stream-transport.ts#L59) |
| `requestHeaders(model: Model<"openai-completions">, options: SimpleStreamOptions \| undefined): Headers` | Builds authenticated JSON request headers without persisting the API key. | function | internal | [line 93](../../src/platform/pi/openai-non-stream-transport.ts#L93) |
| `serializedTools(context: Context, compat: MessageCompat): JsonObject[] \| undefined` | Serializes Pi function tools for an OpenAI-compatible request. | function | internal | [line 113](../../src/platform/pi/openai-non-stream-transport.ts#L113) |
| `buildPayload(model: Model<"openai-completions">, context: Context, options: SimpleStreamOptions \| undefined): JsonObject` | Builds a non-streaming Chat Completions request from Pi model context. | function | internal | [line 136](../../src/platform/pi/openai-non-stream-transport.ts#L136) |
| `asObject(value: unknown, label: string): JsonObject` | Validates that an untrusted protocol value is a JSON object. | function | internal | [line 167](../../src/platform/pi/openai-non-stream-transport.ts#L167) |
| `nonNegativeInteger(value: unknown): number` | Normalizes an untrusted usage counter to a non-negative integer. | function | internal | [line 174](../../src/platform/pi/openai-non-stream-transport.ts#L174) |
| `responseUsage(model: Model<"openai-completions">, raw: ChatCompletionResponse["usage"]): Usage` | Maps provider token usage and model rates to Pi usage metadata. | function | internal | [line 182](../../src/platform/pi/openai-non-stream-transport.ts#L182) |
| `responseText(content: unknown): string` | Extracts text from an OpenAI-compatible assistant response. | function | internal | [line 215](../../src/platform/pi/openai-non-stream-transport.ts#L215) |
| `responseThinking(message: NonNullable<ChatCompletionChoice["message"]>): \| { thinking: string; signature: string } \| undefined` | Extracts optional reasoning text and its provider field name. | function | internal | [line 234](../../src/platform/pi/openai-non-stream-transport.ts#L234) |
| `responseToolCalls(value: unknown): ToolCall[]` | Validates and maps complete provider tool calls to Pi tool-call blocks. | function | internal | [line 250](../../src/platform/pi/openai-non-stream-transport.ts#L250) |
| `finishReason(value: unknown, hasToolCalls: boolean): { stopReason: StopReason; errorMessage?: string }` | Maps an OpenAI finish reason to the Pi stop-reason contract. | function | internal | [line 290](../../src/platform/pi/openai-non-stream-transport.ts#L290) |
| `errorMessageFromBody(text: string): string` | Extracts a bounded provider error message from an HTTP response body. | function | internal | [line 311](../../src/platform/pi/openai-non-stream-transport.ts#L311) |
| `transientHttpStatus(status: number): boolean` | Implements the transient http status operation. | function | internal | [line 326](../../src/platform/pi/openai-non-stream-transport.ts#L326) |
| `retryDelayMs(response: Response, retryIndex: number): number` | Implements the retry delay ms operation. | function | internal | [line 330](../../src/platform/pi/openai-non-stream-transport.ts#L330) |
| `waitForRetry(delayMs: number, signal: AbortSignal \| undefined): Promise<void>` | Implements the wait for retry operation. | function | internal | [line 345](../../src/platform/pi/openai-non-stream-transport.ts#L345) |
| `emitCompletedMessage(stream: ReturnType<typeof createAssistantMessageEventStream>, message: AssistantMessage): void` | Emits one complete assistant response through the Pi event protocol. | function | internal | [line 365](../../src/platform/pi/openai-non-stream-transport.ts#L365) |
| `openAINonStreamingStreamFn(genericModel, context, options)` | Executes one non-streaming Chat Completions request and exposes it as a Pi event stream. | function | exported | [line 438](../../src/platform/pi/openai-non-stream-transport.ts#L438) |
## `src/platform/security/protected-environment.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `sourceFiles(paths: readonly string[], environment: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv>` | Implements the source files operation. | function | internal | [line 4](../../src/platform/security/protected-environment.ts#L4) |
| `loadProtectedEnvironment(paths: readonly string[], baseEnvironment: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv>` | Loads protected environment. | function | exported | [line 41](../../src/platform/security/protected-environment.ts#L41) |
| `requireEnvironmentVariable(environment: NodeJS.ProcessEnv, name: string): string` | Implements the require environment variable operation. | function | exported | [line 61](../../src/platform/security/protected-environment.ts#L61) |
## `src/platform/sqlite/memory-row.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `memoryRowToRecord(row: MemoryRow): MemoryRecord` | Implements the memory row to record operation. | function | exported | [line 15](../../src/platform/sqlite/memory-row.ts#L15) |
## `src/platform/sqlite/pimem-store.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `ftsQuery(text: string): string` | Converts free text into a bounded, escaped SQLite FTS5 OR query. | function | internal | [line 72](../../src/platform/sqlite/pimem-store.ts#L72) |
| `compareRecords(a: MemoryRecord, b: MemoryRecord): number` | Compares records. | function | internal | [line 83](../../src/platform/sqlite/pimem-store.ts#L83) |
| `recordFingerprint(record: MemoryRecord): string` | Implements the record fingerprint operation. | function | internal | [line 94](../../src/platform/sqlite/pimem-store.ts#L94) |
| `isExistingTargetError(error: unknown): boolean` | Checks whether existing target error. | function | internal | [line 108](../../src/platform/sqlite/pimem-store.ts#L108) |
| `validateEmbeddingProfile(profile: EmbeddingProfile): void` | Validates embedding profile. | function | internal | [line 116](../../src/platform/sqlite/pimem-store.ts#L116) |
| `encodeVector(vector: readonly number[], dimensions: number): Buffer` | Implements the encode vector operation. | function | internal | [line 124](../../src/platform/sqlite/pimem-store.ts#L124) |
| `decodeVector(value: Uint8Array, dimensions: number): Float32Array` | Implements the decode vector operation. | function | internal | [line 138](../../src/platform/sqlite/pimem-store.ts#L138) |
| `sameBytes(left: Uint8Array, right: Uint8Array): boolean` | Implements the same bytes operation. | function | internal | [line 160](../../src/platform/sqlite/pimem-store.ts#L160) |
| `MemoryStore` | Implements memory store. | class | exported | [line 168](../../src/platform/sqlite/pimem-store.ts#L168) |
| `MemoryStore.constructor(databasePath: string)` | Creates a memory store instance. | method | public | [line 178](../../src/platform/sqlite/pimem-store.ts#L178) |
| `MemoryStore.close(): void` | Closes owned resources. | method | public | [line 249](../../src/platform/sqlite/pimem-store.ts#L249) |
| `MemoryStore.ingestScope(scopeId: string, records: MemoryRecord[]): ScopeIngestStatus` | Atomically persists one immutable memory scope and reports whether it was inserted or reused. | method | public | [line 260](../../src/platform/sqlite/pimem-store.ts#L260) |
| `MemoryStore.appendMemoryRequest(request: AppendMemoryRequest): AppendMemoryResult` | Appends immutable source messages while the online scope is ingesting. | method | public | [line 331](../../src/platform/sqlite/pimem-store.ts#L331) |
| `MemoryStore.hasPendingAppendRequests(scopeId: string): boolean` | Checks whether pending append requests. | method | public | [line 473](../../src/platform/sqlite/pimem-store.ts#L473) |
| `MemoryStore.markAppendRequestComplete(requestId: string, requestHash: string): void` | Implements the mark append request complete operation. | method | public | [line 480](../../src/platform/sqlite/pimem-store.ts#L480) |
| `MemoryStore.getOnlineScopeState(scopeId: string): OnlineScopeState \| undefined` | Returns online scope state. | method | public | [line 490](../../src/platform/sqlite/pimem-store.ts#L490) |
| `MemoryStore.sealOnlineScope(scopeId: string): OnlineScopeState` | Implements the seal online scope operation. | method | public | [line 497](../../src/platform/sqlite/pimem-store.ts#L497) |
| `MemoryStore.recordsInTurnRange(scopeId: string, sessionId: string, startTurnIndex: number, count: number): MemoryRecord[]` | Implements the records in turn range operation. | method | private | [line 532](../../src/platform/sqlite/pimem-store.ts#L532) |
| `MemoryStore.ensureEvidenceFactIndex(scopeId: string): EvidenceFactIndexStatus` | Builds or validates the deterministic sidecar index for one scope. | method | public | [line 558](../../src/platform/sqlite/pimem-store.ts#L558) |
| `MemoryStore.expandEvidenceOperator(scopeId: string, request: SearchRequest, context: EvidenceOperatorSearchContext, seedHits: readonly StoreSearchHit[]): StoreSearchHit[]` | Expands hybrid/FTS seeds through the versioned database fact index. | method | public | [line 563](../../src/platform/sqlite/pimem-store.ts#L563) |
| `MemoryStore.searchLexical(scopeId: string, request: SearchRequest): StoreSearchHit[]` | Searches lexical. | method | public | [line 572](../../src/platform/sqlite/pimem-store.ts#L572) |
| `MemoryStore.search(scopeId: string, request: SearchRequest): StoreSearchHit[]` | Executes filtered FTS5 search and returns finalized retrieval hits. | method | public | [line 576](../../src/platform/sqlite/pimem-store.ts#L576) |
| `MemoryStore.read(scopeId: string, memoryIds: string[], contextBefore = 0, contextAfter = 0): MemoryRecord[]` | Reads exact memories by ID within one scope. | method | public | [line 655](../../src/platform/sqlite/pimem-store.ts#L655) |
| `MemoryStore.getRecords(scopeId: string, memoryIds: string[]): MemoryRecord[]` | Returns records. | method | public | [line 700](../../src/platform/sqlite/pimem-store.ts#L700) |
| `MemoryStore.listScopeRecords(scopeId: string): MemoryRecord[]` | Implements the list scope records operation. | method | public | [line 717](../../src/platform/sqlite/pimem-store.ts#L717) |
| `MemoryStore.assertEmbeddingProfileConsistent(profile: EmbeddingProfile): void` | Validates embedding profile consistent and throws when invalid. | method | private | [line 731](../../src/platform/sqlite/pimem-store.ts#L731) |
| `MemoryStore.getEmbeddingIndexStatus(scopeId: string, profile: EmbeddingProfile): EmbeddingIndexStatus` | Returns embedding index status. | method | public | [line 757](../../src/platform/sqlite/pimem-store.ts#L757) |
| `MemoryStore.listMissingEmbeddingRecords(scopeId: string, profile: EmbeddingProfile): MemoryRecord[]` | Implements the list missing embedding records operation. | method | public | [line 812](../../src/platform/sqlite/pimem-store.ts#L812) |
| `MemoryStore.storeEmbeddingBatch(records: readonly MemoryRecord[], profile: EmbeddingProfile, vectors: readonly (readonly number[])[]): StoreEmbeddingBatchResult` | Implements the store embedding batch operation. | method | public | [line 831](../../src/platform/sqlite/pimem-store.ts#L831) |
| `MemoryStore.listStoredEmbeddings(scopeId: string, profile: EmbeddingProfile, request: Omit<SearchRequest, "queries" \| "limit"> = {}): StoredEmbeddingRecord[]` | Implements the list stored embeddings operation. | method | public | [line 918](../../src/platform/sqlite/pimem-store.ts#L918) |
| `MemoryStore.findMentionedMemoryIds(scopeId: string, text: string): string[]` | Implements the find mentioned memory ids operation. | method | public | [line 970](../../src/platform/sqlite/pimem-store.ts#L970) |
| `MemoryStore.exportScope(scopeId: string, exportRoot: string): Promise<ScopeExport>` | Writes a sanitized, permission-restricted filesystem export of one scope. | method | public | [line 976](../../src/platform/sqlite/pimem-store.ts#L976) |
| `MemoryStore.create(databasePath: string): Promise<MemoryStore>` | Implements the create operation. | method | public | [line 1053](../../src/platform/sqlite/pimem-store.ts#L1053) |
## `src/retrieval/adapters/openai/openai-compatible-embedder.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `EmbeddingHttpError` | Implements embedding http error. | class | internal | [line 42](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L42) |
| `EmbeddingHttpError.constructor(status: number, dimensionsUnsupported = false, retryAfterMs?: number)` | Creates a embedding http error instance. | method | public | [line 47](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L47) |
| `EmbeddingResponseError` | Implements embedding response error. | class | internal | [line 60](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L60) |
| `EmbeddingResponseError.constructor(message: string)` | Creates a embedding response error instance. | method | public | [line 61](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L61) |
| `EmbeddingTimeoutError` | Implements embedding timeout error. | class | internal | [line 67](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L67) |
| `EmbeddingTimeoutError.constructor()` | Creates a embedding timeout error instance. | method | public | [line 68](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L68) |
| `positiveInteger(value: number, label: string): number` | Implements the positive integer operation. | function | internal | [line 74](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L74) |
| `nonNegativeInteger(value: number, label: string): number` | Implements the non negative integer operation. | function | internal | [line 81](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L81) |
| `endpointFor(baseUrl: string): string` | Implements the endpoint for operation. | function | internal | [line 88](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L88) |
| `cleanEmbeddingText(text: string): string` | Implements the clean embedding text operation. | function | exported | [line 107](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L107) |
| `chunkTextBalanced(text: string, maxLength: number): string[]` | Balances chunks by Unicode code point, following PiMem's Unicode code-point contract. | function | exported | [line 113](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L113) |
| `validateVector(vector: unknown, dimensions: number): number[]` | Validates vector. | function | internal | [line 126](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L126) |
| `averageVectors(vectors: readonly number[][], dimensions: number): number[]` | Implements the average vectors operation. | function | internal | [line 142](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L142) |
| `parsePositiveInteger(value: string \| undefined, fallback: number, variable: string): number` | Parses positive integer. | function | internal | [line 159](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L159) |
| `parseNonNegativeInteger(value: string \| undefined, fallback: number, variable: string): number` | Parses non negative integer. | function | internal | [line 169](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L169) |
| `retryAfterMilliseconds(value: string \| null): number \| undefined` | Implements the retry after milliseconds operation. | function | internal | [line 178](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L178) |
| `retryableEmbeddingError(error: unknown): boolean` | Implements the retryable embedding error operation. | function | internal | [line 189](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L189) |
| `safeEmbeddingError(error: unknown, attempts?: number): Error` | Implements the safe embedding error operation. | function | internal | [line 197](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L197) |
| `wait(delayMs: number, signal?: AbortSignal): Promise<void>` | Implements the wait operation. | function | internal | [line 211](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L211) |
| `clusterChunks(chunks: readonly string[], batchSize: number): string[][]` | Implements the cluster chunks operation. | function | internal | [line 228](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L228) |
| `OpenAICompatibleEmbedder` | Implements open ai compatible embedder. | class | exported | [line 251](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L251) |
| `OpenAICompatibleEmbedder.constructor(options: OpenAICompatibleEmbedderOptions)` | Creates a open ai compatible embedder instance. | method | public | [line 274](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L274) |
| `OpenAICompatibleEmbedder.fromEnvironment(environment: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch, requestGate?: AsyncRequestGate): OpenAICompatibleEmbedder` | Implements the from environment operation. | method | public | [line 316](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L316) |
| `OpenAICompatibleEmbedder.embedDocuments(texts: readonly string[], options: EmbeddingRequestOptions = {}): Promise<number[][]>` | Implements the embed documents operation. | method | public | [line 373](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L373) |
| `OpenAICompatibleEmbedder.embedQueries(texts: readonly string[], options: EmbeddingRequestOptions = {}): Promise<number[][]>` | Implements the embed queries operation. | method | public | [line 380](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L380) |
| `OpenAICompatibleEmbedder.snapshotMetrics(): EmbeddingMetrics` | Implements the snapshot metrics operation. | method | public | [line 387](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L387) |
| `OpenAICompatibleEmbedder.captureEmbeddingAttempts(observer: (metrics: EmbeddingMetrics) => void, operation: () => Promise<T>): Promise<T>` | Observes exact metrics for each provider request started by `operation`. | method | public | [line 401](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L401) |
| `OpenAICompatibleEmbedder.embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>` | Implements the embed operation. | method | private | [line 412](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L412) |
| `OpenAICompatibleEmbedder.embedCluster(inputs: readonly string[], signal?: AbortSignal): Promise<number[][]>` | Implements the embed cluster operation. | method | private | [line 440](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L440) |
| `OpenAICompatibleEmbedder.requestThroughGate(inputs: readonly string[], includeDimensions: boolean, signal?: AbortSignal): Promise<number[][]>` | Implements the request through gate operation. | method | private | [line 447](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L447) |
| `OpenAICompatibleEmbedder.embedClusterWithRetries(inputs: readonly string[], signal?: AbortSignal): Promise<number[][]>` | Implements the embed cluster with retries operation. | method | private | [line 457](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L457) |
| `OpenAICompatibleEmbedder.request(inputs: readonly string[], includeDimensions: boolean, signal?: AbortSignal): Promise<number[][]>` | Implements the request operation. | method | private | [line 510](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L510) |
| `OpenAICompatibleEmbedder.parseResponse(payload: unknown, inputCount: number): number[][]` | Parses response. | method | private | [line 593](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L593) |
| `OpenAICompatibleEmbedder.parseInputTokens(payload: unknown): number \| undefined` | Parses input tokens. | method | private | [line 645](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L645) |
## `src/retrieval/adapters/operators/builtins.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `makeSearchRequest(input: SearchOperatorInput, overrides: { limit?: number; roles?: MemoryRecord["role"][]; order?: SearchOrder; } = {}): SearchRequest` | Implements the make search request operation. | function | internal | [line 16](../../src/retrieval/adapters/operators/builtins.ts#L16) |
| `mergeOperatorHits(preferred: readonly RetrievalHit[], fallback: readonly RetrievalHit[], limit: number): RetrievalHit[]` | Merges operator hits. | function | internal | [line 35](../../src/retrieval/adapters/operators/builtins.ts#L35) |
| `coverageHits(store: SearchOperatorStore, scopeId: string, input: SearchOperatorInput, signal?: AbortSignal): Promise<RetrievalHit[]>` | Implements the coverage hits operation. | function | internal | [line 48](../../src/retrieval/adapters/operators/builtins.ts#L48) |
| `hybridOperator(store: SearchOperatorStore): SearchOperator` | Implements the hybrid operator operation. | function | internal | [line 104](../../src/retrieval/adapters/operators/builtins.ts#L104) |
| `lexicalOperator(store: SearchOperatorStore): SearchOperator` | Implements the lexical operator operation. | function | internal | [line 124](../../src/retrieval/adapters/operators/builtins.ts#L124) |
| `coverageOperator(store: SearchOperatorStore): SearchOperator` | Implements the coverage operator operation. | function | internal | [line 146](../../src/retrieval/adapters/operators/builtins.ts#L146) |
| `historyOperator(store: SearchOperatorStore): SearchOperator` | Implements the history operator operation. | function | internal | [line 171](../../src/retrieval/adapters/operators/builtins.ts#L171) |
| `evidenceOperator(store: SearchOperatorStore, operator: "temporal" \| "numeric"): SearchOperator` | Implements the evidence operator operation. | function | internal | [line 194](../../src/retrieval/adapters/operators/builtins.ts#L194) |
| `builtInSearchOperators(store: SearchOperatorStore): SearchOperator[]` | Creates the built-in search-operator implementations over one injected store. | function | exported | [line 253](../../src/retrieval/adapters/operators/builtins.ts#L253) |
## `src/retrieval/adapters/sqlite/database-evidence-operators.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `compareRecords(left: MemoryRecord, right: MemoryRecord): number` | Compares records. | function | internal | [line 42](../../src/retrieval/adapters/sqlite/database-evidence-operators.ts#L42) |
| `operatorTokens(queries: readonly string[]): string[]` | Implements the operator tokens operation. | function | internal | [line 59](../../src/retrieval/adapters/sqlite/database-evidence-operators.ts#L59) |
| `DatabaseEvidenceOperators` | Owns all deterministic, database-backed evidence indexing and expansion. | class | exported | [line 74](../../src/retrieval/adapters/sqlite/database-evidence-operators.ts#L74) |
| `DatabaseEvidenceOperators.constructor(db: DatabaseSync)` | Creates a database evidence operators instance. | method | public | [line 78](../../src/retrieval/adapters/sqlite/database-evidence-operators.ts#L78) |
| `DatabaseEvidenceOperators.ensureScope(scopeId: string): EvidenceFactIndexStatus` | Lazily materializes facts for one scope and is idempotent. | method | public | [line 84](../../src/retrieval/adapters/sqlite/database-evidence-operators.ts#L84) |
| `DatabaseEvidenceOperators.expand(scopeId: string, request: SearchRequest, context: EvidenceOperatorSearchContext, seedHits: readonly DatabaseOperatorSeed[]): DatabaseOperatorHit[]` | Implements the expand operation. | method | public | [line 88](../../src/retrieval/adapters/sqlite/database-evidence-operators.ts#L88) |
| `DatabaseEvidenceOperators.matchesRequestFilters(record: MemoryRecord, request: SearchRequest): boolean` | Implements the matches request filters operation. | method | private | [line 100](../../src/retrieval/adapters/sqlite/database-evidence-operators.ts#L100) |
| `DatabaseEvidenceOperators.hit(record: MemoryRecord, query: string, retriever: DatabaseOperatorHit["retriever"], rank: number): DatabaseOperatorHit` | Implements the hit operation. | method | private | [line 117](../../src/retrieval/adapters/sqlite/database-evidence-operators.ts#L117) |
| `DatabaseEvidenceOperators.expandTimeline(scopeId: string, request: SearchRequest, context: EvidenceOperatorSearchContext, seedHits: readonly DatabaseOperatorSeed[]): DatabaseOperatorHit[]` | Implements the expand timeline operation. | method | private | [line 133](../../src/retrieval/adapters/sqlite/database-evidence-operators.ts#L133) |
| `DatabaseEvidenceOperators.expandAggregate(scopeId: string, request: SearchRequest, context: EvidenceOperatorSearchContext, seedHits: readonly DatabaseOperatorSeed[]): DatabaseOperatorHit[]` | Implements the expand aggregate operation. | method | private | [line 214](../../src/retrieval/adapters/sqlite/database-evidence-operators.ts#L214) |
## `src/retrieval/adapters/sqlite/evidence-fact-index.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `EvidenceFactIndex` | Versioned, deterministic sidecar index for immutable raw memories. | class | exported | [line 22](../../src/retrieval/adapters/sqlite/evidence-fact-index.ts#L22) |
| `EvidenceFactIndex.constructor(db: DatabaseSync)` | Creates a evidence fact index instance. | method | public | [line 25](../../src/retrieval/adapters/sqlite/evidence-fact-index.ts#L25) |
| `EvidenceFactIndex.ensureScope(scopeId: string): EvidenceFactIndexStatus` | Implements the ensure scope operation. | method | public | [line 30](../../src/retrieval/adapters/sqlite/evidence-fact-index.ts#L30) |
| `EvidenceFactIndex.initializeSchema(): void` | Implements the initialize schema operation. | method | private | [line 37](../../src/retrieval/adapters/sqlite/evidence-fact-index.ts#L37) |
| `EvidenceFactIndex.assertContentHashes(scopeId: string): void` | Validates content hashes and throws when invalid. | method | private | [line 82](../../src/retrieval/adapters/sqlite/evidence-fact-index.ts#L82) |
| `EvidenceFactIndex.listUnindexedRows(scopeId: string): MemoryRow[]` | Implements the list unindexed rows operation. | method | private | [line 96](../../src/retrieval/adapters/sqlite/evidence-fact-index.ts#L96) |
| `EvidenceFactIndex.indexRows(rows: readonly MemoryRow[]): void` | Indexes rows. | method | private | [line 110](../../src/retrieval/adapters/sqlite/evidence-fact-index.ts#L110) |
| `EvidenceFactIndex.indexRecord(row: MemoryRow, insertNumeric: ReturnType<DatabaseSync["prepare"]>, insertTemporal: ReturnType<DatabaseSync["prepare"]>, markIndexed: ReturnType<DatabaseSync["prepare"]>): void` | Indexes record. | method | private | [line 139](../../src/retrieval/adapters/sqlite/evidence-fact-index.ts#L139) |
| `EvidenceFactIndex.status(scopeId: string): EvidenceFactIndexStatus` | Implements the status operation. | method | private | [line 198](../../src/retrieval/adapters/sqlite/evidence-fact-index.ts#L198) |
## `src/retrieval/finalize-search-hits.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `timestampValue(hit: RetrievalHit): string` | Implements the timestamp value operation. | function | internal | [line 3](../../src/retrieval/finalize-search-hits.ts#L3) |
| `finalizeSearchHits(relevanceOrderedHits: readonly RetrievalHit[], request: SearchRequest, limit: number): RetrievalHit[]` | Finalizes search hits. | function | exported | [line 7](../../src/retrieval/finalize-search-hits.ts#L7) |
## `src/retrieval/index-scope-embeddings.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `embeddingProfile(embedder: Embedder): EmbeddingProfile` | Implements the embedding profile operation. | function | exported | [line 15](../../src/retrieval/index-scope-embeddings.ts#L15) |
| `embeddingInput(role: string, content: string): string` | Implements the embedding input operation. | function | exported | [line 23](../../src/retrieval/index-scope-embeddings.ts#L23) |
| `indexScopeEmbeddings(store: EmbeddingIndexStore, scopeId: string, embedder: Embedder, signal?: AbortSignal): Promise<EmbeddingIndexResult>` | Indexes scope embeddings. | function | exported | [line 27](../../src/retrieval/index-scope-embeddings.ts#L27) |
## `src/retrieval/index.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval/model/embedder.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval/model/embedding.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval/model/retrieval.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval/model/search-operator.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval/operators/hybrid-search.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `cosineSimilarity(left: ArrayLike<number>, right: ArrayLike<number>): number` | Implements the cosine similarity operation. | function | internal | [line 28](../../src/retrieval/operators/hybrid-search.ts#L28) |
| `compareFinal(left: RankedHybridHit, right: RankedHybridHit): number` | Compares final. | function | internal | [line 49](../../src/retrieval/operators/hybrid-search.ts#L49) |
| `candidateText(candidate: Pick<StoredEmbeddingRecord, "record">): string` | Checks whether didate text. | function | internal | [line 57](../../src/retrieval/operators/hybrid-search.ts#L57) |
| `HybridMemoryStore` | Implements hybrid memory store. | class | exported | [line 79](../../src/retrieval/operators/hybrid-search.ts#L79) |
| `HybridMemoryStore.constructor(rawStore: HybridSearchStore, embedder: Embedder)` | Creates a hybrid memory store instance. | method | public | [line 86](../../src/retrieval/operators/hybrid-search.ts#L86) |
| `HybridMemoryStore.getRetrievalMetadata(): RetrievalMetadata` | Returns retrieval metadata. | method | public | [line 91](../../src/retrieval/operators/hybrid-search.ts#L91) |
| `HybridMemoryStore.snapshotRetrievalMetrics(): RetrievalMetricsSnapshot` | Implements the snapshot retrieval metrics operation. | method | public | [line 100](../../src/retrieval/operators/hybrid-search.ts#L100) |
| `HybridMemoryStore.search(scopeId: string, request: SearchRequest, signal?: AbortSignal): Promise<RetrievalHit[]>` | Performs a search. | method | public | [line 110](../../src/retrieval/operators/hybrid-search.ts#L110) |
| `HybridMemoryStore.searchLexical(scopeId: string, request: SearchRequest): RetrievalHit[]` | Searches lexical. | method | public | [line 260](../../src/retrieval/operators/hybrid-search.ts#L260) |
| `HybridMemoryStore.expandEvidenceOperator(scopeId: string, request: SearchRequest, context: EvidenceOperatorSearchContext, seedHits: readonly RetrievalHit[]): RetrievalHit[]` | Implements the expand evidence operator operation. | method | public | [line 267](../../src/retrieval/operators/hybrid-search.ts#L267) |
| `HybridMemoryStore.read(scopeId: string, memoryIds: string[], contextBefore = 0, contextAfter = 0): MemoryRecord[]` | Reads the requested value. | method | public | [line 281](../../src/retrieval/operators/hybrid-search.ts#L281) |
| `HybridMemoryStore.getRecords(scopeId: string, memoryIds: string[]): MemoryRecord[]` | Returns records. | method | public | [line 295](../../src/retrieval/operators/hybrid-search.ts#L295) |
| `HybridMemoryStore.findMentionedMemoryIds(scopeId: string, text: string): string[]` | Implements the find mentioned memory ids operation. | method | public | [line 299](../../src/retrieval/operators/hybrid-search.ts#L299) |
## `src/retrieval/operators/numeric-operator.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `numericValue(raw: string): number \| undefined` | Implements the numeric value operation. | function | internal | [line 27](../../src/retrieval/operators/numeric-operator.ts#L27) |
| `extractNumericMentions(content: string): Omit<NumericFact, "valueKind">[]` | Implements the extract numeric mentions operation. | function | internal | [line 32](../../src/retrieval/operators/numeric-operator.ts#L32) |
| `classifyValue(content: string, mention: Omit<NumericFact, "valueKind">): NumericValueKind` | Implements the classify value operation. | function | internal | [line 98](../../src/retrieval/operators/numeric-operator.ts#L98) |
| `extractNumericFacts(content: string): NumericFact[]` | Implements the extract numeric facts operation. | function | exported | [line 117](../../src/retrieval/operators/numeric-operator.ts#L117) |
| `rowKey(hit: RetrievalHit, mention: NumericFact): string` | Implements the row key operation. | function | internal | [line 124](../../src/retrieval/operators/numeric-operator.ts#L124) |
| `buildAggregateOperatorResult(hits: readonly RetrievalHit[]): EvidenceOperatorResult` | Builds aggregate operator result. | function | exported | [line 128](../../src/retrieval/operators/numeric-operator.ts#L128) |
## `src/retrieval/operators/temporal-operator.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `isoDate(timestamp: number): string` | Checks whether o date. | function | internal | [line 68](../../src/retrieval/operators/temporal-operator.ts#L68) |
| `startOfDay(timestamp: number): number` | Implements the start of day operation. | function | internal | [line 72](../../src/retrieval/operators/temporal-operator.ts#L72) |
| `addCalendarUnits(timestamp: number, amount: number, unit: "day" \| "week" \| "month" \| "year"): number` | Implements the add calendar units operation. | function | internal | [line 77](../../src/retrieval/operators/temporal-operator.ts#L77) |
| `cleanQuestion(question: string): string` | Implements the clean question operation. | function | internal | [line 90](../../src/retrieval/operators/temporal-operator.ts#L90) |
| `parseAmount(value: string): number \| undefined` | Parses amount. | function | internal | [line 100](../../src/retrieval/operators/temporal-operator.ts#L100) |
| `resolveTemporalQuestion(question: string, questionDate?: string): TemporalQuestionPlan` | Resolves temporal question. | function | exported | [line 105](../../src/retrieval/operators/temporal-operator.ts#L105) |
| `temporalAuxiliaryRequest(request: SearchRequest, plan: TemporalQuestionPlan): SearchRequest \| undefined` | Implements the temporal auxiliary request operation. | function | exported | [line 193](../../src/retrieval/operators/temporal-operator.ts#L193) |
| `explicitDates(content: string, fallbackYear?: number): string[]` | Implements the explicit dates operation. | function | internal | [line 214](../../src/retrieval/operators/temporal-operator.ts#L214) |
| `extractTemporalFacts(content: string, sourceTimestamp?: string): TemporalFact[]` | Extracts deterministic event-date facts from one immutable memory turn. | function | exported | [line 239](../../src/retrieval/operators/temporal-operator.ts#L239) |
| `buildTimelineOperatorResult(hits: readonly RetrievalHit[], question: string, questionDate?: string, auxiliaryRequest?: SearchRequest): EvidenceOperatorResult` | Builds timeline operator result. | function | exported | [line 338](../../src/retrieval/operators/temporal-operator.ts#L338) |
## `src/retrieval/ports/memory-tool-store.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval/ports/operator-catalog.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval/ports/search-operator-plugin.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval/ports/search-operator.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval/ranking.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `tokenizeForPiMemHybrid(text: string): string[]` | Tokenizes candidate text for PiMem hybrid BM25 after \W+ cleanup. | function | exported | [line 39](../../src/retrieval/ranking.ts#L39) |
| `bm25Scores(query: string, documents: readonly string[], options: Readonly<Bm25Options> = PIMEM_HYBRID_BM25_OPTIONS): number[]` | Implements the bm25 scores operation. | function | exported | [line 48](../../src/retrieval/ranking.ts#L48) |
| `reciprocalRankFusion(rankings: readonly (readonly number[])[], k = 60, documentCount?: number): number[]` | Returns one RRF score per zero-based document index. | function | exported | [line 112](../../src/retrieval/ranking.ts#L112) |
## `src/retrieval/retrieval-profile.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `parseRetrievalProfile(value: string \| undefined): RetrievalProfile` | Parses retrieval profile. | function | exported | [line 5](../../src/retrieval/retrieval-profile.ts#L5) |
## `src/retrieval/search-memory.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `normalizeStrings(values: readonly string[], label: string): string[]` | Validates, trims, and deduplicates a list of search values. | function | internal | [line 27](../../src/retrieval/search-memory.ts#L27) |
| `searchQueryFingerprint(query: string): string` | Creates a canonical fingerprint used to detect repeated queries. | function | internal | [line 37](../../src/retrieval/search-memory.ts#L37) |
| `createSearchMemory(options: SearchMemoryOptions): ( params: { operator?: string; queries: string[]; limit?: number }, signal?: AbortSignal, ) => Promise<SearchMemoryResult>` | Creates the search orchestrator for normalization, routing, coverage, expansion, and hit merging. | function | exported | [line 46](../../src/retrieval/search-memory.ts#L46) |
## `src/retrieval/temporal-annotation.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `parseSourceTimestamp(value: string \| undefined): number \| undefined` | Parses source timestamp. | function | exported | [line 4](../../src/retrieval/temporal-annotation.ts#L4) |
| `durationParts(milliseconds: number): string` | Implements the duration parts operation. | function | internal | [line 29](../../src/retrieval/temporal-annotation.ts#L29) |
| `temporalAnnotation(memoryTimestamp: string \| undefined, questionDate: string \| undefined): string \| undefined` | Implements the temporal annotation operation. | function | exported | [line 43](../../src/retrieval/temporal-annotation.ts#L43) |
## `src/retrieval/use-cases/build-declarative-operator.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `normalizedText(value: string, label: string, maxLength = 240): string` | Normalizes d text. | function | internal | [line 26](../../src/retrieval/use-cases/build-declarative-operator.ts#L26) |
| `normalizedIdentifier(value: string, label: string): string` | Normalizes d identifier. | function | internal | [line 35](../../src/retrieval/use-cases/build-declarative-operator.ts#L35) |
| `normalizedLimit(value: number \| undefined, label: string): number \| undefined` | Normalizes d limit. | function | internal | [line 45](../../src/retrieval/use-cases/build-declarative-operator.ts#L45) |
| `normalizeDefinition(catalog: SearchOperatorCatalog, source: SearchOperatorDefinition): NormalizedDefinition` | Normalizes definition. | function | internal | [line 56](../../src/retrieval/use-cases/build-declarative-operator.ts#L56) |
| `withRanks(hits: readonly RetrievalHit[], limit: number): RetrievalHit[]` | Implements the with ranks operation. | function | internal | [line 202](../../src/retrieval/use-cases/build-declarative-operator.ts#L202) |
| `unionCandidateSets(sets: readonly (readonly RetrievalHit[])[], limit: number): RetrievalHit[]` | Implements the union candidate sets operation. | function | internal | [line 209](../../src/retrieval/use-cases/build-declarative-operator.ts#L209) |
| `rrfCandidateSets(sets: readonly (readonly RetrievalHit[])[], limit: number): RetrievalHit[]` | Implements the rrf candidate sets operation. | function | internal | [line 226](../../src/retrieval/use-cases/build-declarative-operator.ts#L226) |
| `requestFor(input: SearchOperatorInput): SearchRequest` | Implements the request for operation. | function | internal | [line 258](../../src/retrieval/use-cases/build-declarative-operator.ts#L258) |
| `buildDeclarativeSearchOperator(catalog: SearchOperatorCatalog, source: SearchOperatorDefinition, definitionRevision: number): BuiltDeclarativeSearchOperator` | Validates a bounded operator graph and builds a candidate-only executable operator. | function | exported | [line 275](../../src/retrieval/use-cases/build-declarative-operator.ts#L275) |
## `src/retrieval/use-cases/execute-operator.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `executeSearchOperator(registry: SearchOperatorCatalog, operatorId: string, context: SearchOperatorExecutionContext, input: SearchOperatorInput): Promise<ExecutedSearchOperator>` | Runs a registered operator and rejects candidate hits from another scope. | function | exported | [line 13](../../src/retrieval/use-cases/execute-operator.ts#L13) |
## `src/retrieval/use-cases/operator-registry.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `normalizedText(value: string, label: string): string` | Normalizes d text. | function | internal | [line 18](../../src/retrieval/use-cases/operator-registry.ts#L18) |
| `catalogEntry(operator: SearchOperator): SearchOperatorCatalogEntry` | Implements the catalog entry operation. | function | internal | [line 24](../../src/retrieval/use-cases/operator-registry.ts#L24) |
| `SearchOperatorRegistry` | Implements search operator registry. | class | exported | [line 39](../../src/retrieval/use-cases/operator-registry.ts#L39) |
| `SearchOperatorRegistry.constructor(defaultOperatorId = "hybrid")` | Creates a search operator registry instance. | method | public | [line 45](../../src/retrieval/use-cases/operator-registry.ts#L45) |
| `SearchOperatorRegistry.register(operator: SearchOperator): this` | Validates and registers one uniquely named search operator before freeze. | method | public | [line 52](../../src/retrieval/use-cases/operator-registry.ts#L52) |
| `SearchOperatorRegistry.freeze(): this` | Seals the catalog after verifying its default operator exists. | method | public | [line 74](../../src/retrieval/use-cases/operator-registry.ts#L74) |
| `SearchOperatorRegistry.get(operatorId: string): SearchOperator` | Resolves an allowlisted operator or reports the available catalog. | method | public | [line 84](../../src/retrieval/use-cases/operator-registry.ts#L84) |
| `SearchOperatorRegistry.list(): SearchOperatorCatalogEntry[]` | Returns a detached runtime catalog for schemas, prompts, and manifests. | method | public | [line 96](../../src/retrieval/use-cases/operator-registry.ts#L96) |
| `SearchOperatorRegistry.forkForRun(maxDefinitions = 2): RuntimeSearchOperatorCatalog` | Creates an isolated mutable overlay over the frozen base catalog. | method | public | [line 101](../../src/retrieval/use-cases/operator-registry.ts#L101) |
| `SearchOperatorRegistry.assertFrozen(): void` | Validates frozen and throws when invalid. | method | private | [line 106](../../src/retrieval/use-cases/operator-registry.ts#L106) |
| `RunSearchOperatorCatalog` | Implements run search operator catalog. | class | internal | [line 113](../../src/retrieval/use-cases/operator-registry.ts#L113) |
| `RunSearchOperatorCatalog.constructor(private readonly base: SearchOperatorRegistry, private readonly maxDefinitions: number)` | Creates a run search operator catalog instance. | method | public | [line 124](../../src/retrieval/use-cases/operator-registry.ts#L124) |
| `RunSearchOperatorCatalog.get(operatorId: string): SearchOperator` | Implements the get operation. | method | public | [line 140](../../src/retrieval/use-cases/operator-registry.ts#L140) |
| `RunSearchOperatorCatalog.list(): SearchOperatorCatalogEntry[]` | Implements the list operation. | method | public | [line 146](../../src/retrieval/use-cases/operator-registry.ts#L146) |
| `RunSearchOperatorCatalog.define(source: SearchOperatorDefinition): DefinedSearchOperator` | Validates and registers one declarative operator only within the current run. | method | public | [line 155](../../src/retrieval/use-cases/operator-registry.ts#L155) |
| `RunSearchOperatorCatalog.identity(): SearchOperatorCatalogIdentity` | Hashes the frozen base catalog and ordered run-local definitions. | method | public | [line 182](../../src/retrieval/use-cases/operator-registry.ts#L182) |
| `RunSearchOperatorCatalog.snapshots(): SearchOperatorDefinitionSnapshot[]` | Returns detached normalized definitions for audit and later promotion. | method | public | [line 196](../../src/retrieval/use-cases/operator-registry.ts#L196) |
| `RunSearchOperatorCatalog.remainingDefinitions(): number` | Reports the remaining bounded definition capacity for the current run. | method | public | [line 204](../../src/retrieval/use-cases/operator-registry.ts#L204) |
| `renderSearchOperatorCatalog(entries: readonly SearchOperatorCatalogEntry[]): string` | Renders operator capabilities into the catalog shown to the agent. | function | exported | [line 209](../../src/retrieval/use-cases/operator-registry.ts#L209) |
## `src/tau-knowledge-bridge.ts`

_No top-level functions, classes, or class methods._
## `src/util.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `sha256(value: string): string` | Implements the sha256 operation. | function | exported | [line 3](../../src/util.ts#L3) |
| `stableMemoryId(scopeId: string, sessionId: string, turnIndex: number, sourceId?: string): string` | Implements the stable memory id operation. | function | exported | [line 7](../../src/util.ts#L7) |
| `compactPreview(text: string, maxLength = 280): string` | Implements the compact preview operation. | function | exported | [line 18](../../src/util.ts#L18) |
| `episodicPreview(text: string, maxLength = 360): string` | Keeps both setup and the sentence-final episodic fact in search previews. | function | exported | [line 26](../../src/util.ts#L26) |
| `safePathSegment(value: string): string` | Implements the safe path segment operation. | function | exported | [line 36](../../src/util.ts#L36) |
| `newRunId(): string` | Implements the new run id operation. | function | exported | [line 45](../../src/util.ts#L45) |
| `assertNonEmpty(value: string, label: string): string` | Validates non empty and throws when invalid. | function | exported | [line 49](../../src/util.ts#L49) |
