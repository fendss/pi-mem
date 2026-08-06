# Code Catalog

This file is generated from the TypeScript AST. It is the function-level directory for the project and must not be edited manually.

Run `npm run docs:catalog` after adding, removing, renaming, or moving source symbols.

## `src/adapters/longmemeval.ts`

_No top-level functions, classes, or class methods._
## `src/aggregate-operator.ts`

_No top-level functions, classes, or class methods._
## `src/async-pool.ts`

_No top-level functions, classes, or class methods._
## `src/bash-ro.ts`

_No top-level functions, classes, or class methods._
## `src/benchmark-answer.ts`

_No top-level functions, classes, or class methods._
## `src/benchmark/answer-from-evidence.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `lastAssistantMessage(messages: readonly unknown[]): AssistantMessage \| undefined` | Returns the final assistant message emitted by the answer model. | function | internal | [line 25](../../src/benchmark/answer-from-evidence.ts#L25) |
| `assistantText(message: AssistantMessage): string` | Extracts plain text from an assistant message. | function | internal | [line 42](../../src/benchmark/answer-from-evidence.ts#L42) |
| `returnedModelMatches(requested: string, returned: string): boolean` | Checks whether the provider's response model matches the requested model. | function | exported | [line 55](../../src/benchmark/answer-from-evidence.ts#L55) |
| `runBenchmarkAnswer(options: { modelRuntime: PiModelRuntime; prompt: BenchmarkAnswerPrompt; maxRunMs?: number; }): Promise<BenchmarkAnswerResult>` | Runs benchmark-owned answer synthesis after PiMem has finished retrieval. | function | exported | [line 60](../../src/benchmark/answer-from-evidence.ts#L60) |
## `src/benchmark/index.ts`

_No top-level functions, classes, or class methods._
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
## `src/benchmark/model/benchmark-query.ts`

_No top-level functions, classes, or class methods._
## `src/benchmark/model/benchmark-run.ts`

_No top-level functions, classes, or class methods._
## `src/benchmark/use-cases/run-question.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `runQuestion(paths: LongMemEvalDataPaths, retrievalProfile: RetrievalProfile, scopeId: string, question: string, questionDate: string \| undefined, modelOptions: LoadPiModelRuntimeOptions): Promise<PiMemResult>` | Runs question. | function | exported | [line 18](../../src/benchmark/use-cases/run-question.ts#L18) |
| `runQuestionWithRuntime(paths: LongMemEvalDataPaths, store: PiMemRuntimeStore, modelRuntime: PiModelRuntime, scopeId: string, question: string, questionDate?: string, runtimeLimits: { maxRunMs?: number; maxTurns?: number; maxToolCalls?: number; } = {}): Promise<PiMemResult>` | Runs question with runtime. | function | exported | [line 43](../../src/benchmark/use-cases/run-question.ts#L43) |
## `src/cli.ts`

_No top-level functions, classes, or class methods._
## `src/composition/create-retrieval-context.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createRetrievalContext(rawStore: MemoryStore, profile: RetrievalProfile, embedder?: Embedder): RetrievalContext` | Creates retrieval context. | function | exported | [line 17](../../src/composition/create-retrieval-context.ts#L17) |
## `src/context.ts`

_No top-level functions, classes, or class methods._
## `src/database-evidence-operators.ts`

_No top-level functions, classes, or class methods._
## `src/embedding-index.ts`

_No top-level functions, classes, or class methods._
## `src/embedding.ts`

_No top-level functions, classes, or class methods._
## `src/entrypoints/cli/commands/benchmark-longmemeval.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `successRecordPath(recordsDir: string, questionId: string): string` | Implements the success record path operation. | function | internal | [line 52](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L52) |
| `failureRecordPath(failuresDir: string, questionId: string): string` | Implements the failure record path operation. | function | internal | [line 56](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L56) |
| `completedQuestionIds(path: string): Promise<Set<string>>` | Implements the completed question ids operation. | function | internal | [line 60](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L60) |
| `predictionFor(retrieval: PiMemResult, answer: BenchmarkAnswerResult, questionId: string): BenchmarkPrediction` | Implements the prediction for operation. | function | internal | [line 78](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L78) |
| `ensureBenchmarkManifest(path: string, config: Record<string, unknown>): Promise<void>` | Implements the ensure benchmark manifest operation. | function | internal | [line 106](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L106) |
| `loadSuccessRecords(recordsDir: string, questions: readonly LongMemEvalPrivateQuestion[]): Promise<Map<string, BenchmarkSuccessRecord>>` | Loads success records. | function | internal | [line 132](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L132) |
| `readJsonlMap(path: string): Promise<Map<string, unknown>>` | Reads jsonl map. | function | internal | [line 153](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L153) |
| `materializeBenchmarkArtifacts(outputDir: string, selected: readonly LongMemEvalPrivateQuestion[]): Promise<{ succeeded: number; failed: number }>` | Materializes benchmark artifacts. | function | internal | [line 173](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L173) |
| `systemicRuntimeFailure(message: string): boolean` | Implements the systemic runtime failure operation. | function | internal | [line 244](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L244) |
| `benchmarkLongMemEval(parsed: ParsedCommand): Promise<void>` | Implements the benchmark long mem eval operation. | function | exported | [line 250](../../src/entrypoints/cli/commands/benchmark-longmemeval.ts#L250) |
## `src/entrypoints/cli/commands/ingest-longmemeval.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `ingestLongMemEval(parsed: ParsedCommand): Promise<void>` | Implements the ingest long mem eval operation. | function | exported | [line 25](../../src/entrypoints/cli/commands/ingest-longmemeval.ts#L25) |
## `src/entrypoints/cli/commands/longmemeval-suite.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `sleep(milliseconds: number): Promise<void>` | Implements the sleep operation. | function | internal | [line 37](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L37) |
| `jsonRecordCount(directory: string): Promise<number>` | Implements the json record count operation. | function | internal | [line 43](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L43) |
| `runLoggedChild(options: { file: string; args: string[]; environment: NodeJS.ProcessEnv; logPath: string; mirrorStderr?: boolean; }): Promise<number>` | Runs logged child. | function | internal | [line 59](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L59) |
| `unresolvedFailureMessages(outputDir: string): Promise<string[]>` | Implements the unresolved failure messages operation. | function | internal | [line 99](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L99) |
| `auditLongMemEvalSuite(outputDir: string, expected: number): Promise<Record<string, unknown>>` | Implements the audit long mem eval suite operation. | function | internal | [line 122](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L122) |
| `baselineScores(parsed: ParsedCommand): Array<{ name: string; accuracy: number; }>` | Implements the baseline scores operation. | function | internal | [line 212](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L212) |
| `packageEvaluationArtifacts(outputDir: string, archivePath: string): Promise<void>` | Packages evaluation artifacts. | function | internal | [line 230](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L230) |
| `longMemEvalSuite(parsed: ParsedCommand): Promise<void>` | Implements the long mem eval suite operation. | function | exported | [line 285](../../src/entrypoints/cli/commands/longmemeval-suite.ts#L285) |
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
| `runLongMemEval(parsed: ParsedCommand): Promise<void>` | Runs long mem eval. | function | exported | [line 17](../../src/entrypoints/cli/commands/run-longmemeval.ts#L17) |
## `src/entrypoints/cli/commands/run-memory.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `runGeneric(parsed: ParsedCommand): Promise<void>` | Runs generic. | function | exported | [line 12](../../src/entrypoints/cli/commands/run-memory.ts#L12) |
## `src/entrypoints/cli/main.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `printHelp(): void` | Implements the print help operation. | function | internal | [line 11](../../src/entrypoints/cli/main.ts#L11) |
| `main(): Promise<void>` | Implements the main operation. | function | internal | [line 25](../../src/entrypoints/cli/main.ts#L25) |
## `src/entrypoints/cli/parse-command.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `parseCommand(argv: string[]): ParsedCommand` | Parses command. | function | exported | [line 12](../../src/entrypoints/cli/parse-command.ts#L12) |
| `requiredFlag(parsed: ParsedCommand, name: string): string` | Implements the required flag operation. | function | exported | [line 34](../../src/entrypoints/cli/parse-command.ts#L34) |
| `optionalFlag(parsed: ParsedCommand, name: string): string \| undefined` | Implements the optional flag operation. | function | exported | [line 42](../../src/entrypoints/cli/parse-command.ts#L42) |
| `positiveIntegerFlag(parsed: ParsedCommand, name: string, fallback: number, maximum: number): number` | Implements the positive integer flag operation. | function | exported | [line 54](../../src/entrypoints/cli/parse-command.ts#L54) |
| `positiveNumberFlag(parsed: ParsedCommand, name: string, fallback: number, maximum: number): number` | Implements the positive number flag operation. | function | exported | [line 69](../../src/entrypoints/cli/parse-command.ts#L69) |
| `modelOptionsFor(parsed: ParsedCommand): LoadPiModelRuntimeOptions` | Implements the model options for operation. | function | exported | [line 84](../../src/entrypoints/cli/parse-command.ts#L84) |
| `assertOnlyFlags(parsed: ParsedCommand, allowed: readonly string[]): void` | Validates only flags and throws when invalid. | function | exported | [line 136](../../src/entrypoints/cli/parse-command.ts#L136) |
| `retrievalProfileFor(parsed: ParsedCommand): RetrievalProfile` | Implements the retrieval profile for operation. | function | exported | [line 146](../../src/entrypoints/cli/parse-command.ts#L146) |
## `src/entrypoints/cli/workflow-files.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `writeAtomicText(path: string, serialized: string): Promise<void>` | Writes a file through a permission-restricted temporary file and atomic rename. | function | exported | [line 7](../../src/entrypoints/cli/workflow-files.ts#L7) |
| `writeAtomicJson(path: string, value: unknown): Promise<void>` | Serializes a value as formatted JSON and writes it atomically. | function | exported | [line 21](../../src/entrypoints/cli/workflow-files.ts#L21) |
| `readJsonFileIfPresent(path: string): Promise<T \| undefined>` | Reads a JSON file, returning undefined only when the file is absent. | function | exported | [line 29](../../src/entrypoints/cli/workflow-files.ts#L29) |
| `executeArchiveCommand(file: string, args: string[]): Promise<void>` | Executes a command used to create an archive and normalizes its error. | function | exported | [line 43](../../src/entrypoints/cli/workflow-files.ts#L43) |
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
## `src/evidence-agent/adapters/docker/read-only-shell.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `buildBashRoDockerArgs(scopePath: string, command: string, image = DEFAULT_IMAGE, containerUser = "0:0"): string[]` | Builds bash ro docker args. | function | exported | [line 23](../../src/evidence-agent/adapters/docker/read-only-shell.ts#L23) |
| `ReadOnlyBash` | Runs a shell inside a disposable, networkless container with exactly one sanitized memory scope mounted read-only. | class | exported | [line 64](../../src/evidence-agent/adapters/docker/read-only-shell.ts#L64) |
| `ReadOnlyBash.constructor(options: BashRoOptions = {})` | Creates a read only bash instance. | method | public | [line 71](../../src/evidence-agent/adapters/docker/read-only-shell.ts#L71) |
| `ReadOnlyBash.run(scopePath: string, command: string, signal?: AbortSignal): Promise<BashRoResult>` | Runs the operation. | method | public | [line 84](../../src/evidence-agent/adapters/docker/read-only-shell.ts#L84) |
## `src/evidence-agent/adapters/pi/ephemeral-context.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `isToolResult(message: AgentMessage): message is ToolResultMessage` | Checks whether tool result. | function | internal | [line 15](../../src/evidence-agent/adapters/pi/ephemeral-context.ts#L15) |
| `trailingToolResultStart(messages: readonly AgentMessage[]): number` | Implements the trailing tool result start operation. | function | internal | [line 19](../../src/evidence-agent/adapters/pi/ephemeral-context.ts#L19) |
| `createEphemeralMemoryContext(): EphemeralMemoryContext` | Keeps the current tool batch visible once, then expires navigation payloads. | function | exported | [line 30](../../src/evidence-agent/adapters/pi/ephemeral-context.ts#L30) |
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
| `createPiMemTools(options: CreatePiMemToolsOptions): PiMemTools` | Creates pi mem tools. | function | exported | [line 7](../../src/evidence-agent/adapters/pi/tools/create-tools.ts#L7) |
## `src/evidence-agent/adapters/pi/tools/finish-tool.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createFinishTool(options: CreatePiMemToolsOptions): PiMemTools["finish"]` | Creates finish tool. | function | exported | [line 6](../../src/evidence-agent/adapters/pi/tools/finish-tool.ts#L6) |
## `src/evidence-agent/adapters/pi/tools/read-tool.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createReadTool(options: CreatePiMemToolsOptions): PiMemTools["read"]` | Creates read tool. | function | exported | [line 6](../../src/evidence-agent/adapters/pi/tools/read-tool.ts#L6) |
## `src/evidence-agent/adapters/pi/tools/render-tool-result.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `temporalSuffix(timestamp: string \| undefined, questionDate: string \| undefined): string` | Implements the temporal suffix operation. | function | internal | [line 9](../../src/evidence-agent/adapters/pi/tools/render-tool-result.ts#L9) |
| `renderEvidenceOperator(result: EvidenceOperatorResult \| undefined, ledger: MemoryLedger): string` | Renders evidence operator. | function | exported | [line 17](../../src/evidence-agent/adapters/pi/tools/render-tool-result.ts#L17) |
| `renderCandidates(candidates: readonly MemoryCandidate[], ledger: MemoryLedger, questionDate?: string): string` | Renders candidates. | function | exported | [line 67](../../src/evidence-agent/adapters/pi/tools/render-tool-result.ts#L67) |
| `renderMemories(memories: readonly MemoryRecord[], ledger: MemoryLedger, questionDate?: string): string` | Renders memories. | function | exported | [line 89](../../src/evidence-agent/adapters/pi/tools/render-tool-result.ts#L89) |
## `src/evidence-agent/adapters/pi/tools/schemas.ts`

_No top-level functions, classes, or class methods._
## `src/evidence-agent/adapters/pi/tools/search-tool.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `createSearchTool(options: CreatePiMemToolsOptions): PiMemTools["search"]` | Creates the Pi search tool that delegates retrieval and records returned candidates in the ledger. | function | exported | [line 6](../../src/evidence-agent/adapters/pi/tools/search-tool.ts#L6) |
## `src/evidence-agent/adapters/pi/tools/tool-protocol.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `validateFinishToolBatch(toolNames: readonly string[], finishToolName = "finish"): string \| undefined` | Validates finish tool batch. | function | exported | [line 7](../../src/evidence-agent/adapters/pi/tools/tool-protocol.ts#L7) |
| `createFinishOnlyBeforeToolCall(finishToolName = "finish"): ( context: BeforeToolCallContext, signal?: AbortSignal, ) => Promise<BeforeToolCallResult \| undefined>` | Creates finish only before tool call. | function | exported | [line 18](../../src/evidence-agent/adapters/pi/tools/tool-protocol.ts#L18) |
## `src/evidence-agent/index.ts`

_No top-level functions, classes, or class methods._
## `src/evidence-agent/model/evidence.ts`

_No top-level functions, classes, or class methods._
## `src/evidence-agent/model/memory-ledger.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `cloneCandidate(candidate: MemoryCandidate): MemoryCandidate` | Implements the clone candidate operation. | function | internal | [line 10](../../src/evidence-agent/model/memory-ledger.ts#L10) |
| `cloneRecord(record: MemoryRecord): MemoryRecord` | Implements the clone record operation. | function | internal | [line 19](../../src/evidence-agent/model/memory-ledger.ts#L19) |
| `cloneSelection(selection: PiMemSelection): PiMemSelection` | Implements the clone selection operation. | function | internal | [line 26](../../src/evidence-agent/model/memory-ledger.ts#L26) |
| `MemoryLedger` | Per-question, in-memory provenance ledger. | class | exported | [line 52](../../src/evidence-agent/model/memory-ledger.ts#L52) |
| `MemoryLedger.constructor(scopeId: string)` | Creates a memory ledger instance. | method | public | [line 64](../../src/evidence-agent/model/memory-ledger.ts#L64) |
| `MemoryLedger.nextStep(): number` | Implements the next step operation. | method | public | [line 72](../../src/evidence-agent/model/memory-ledger.ts#L72) |
| `MemoryLedger.hasRead(memoryId: string): boolean` | Checks whether read. | method | public | [line 102](../../src/evidence-agent/model/memory-ledger.ts#L102) |
| `MemoryLedger.candidateRef(memoryId: string): number \| undefined` | Checks whether didate ref. | method | public | [line 106](../../src/evidence-agent/model/memory-ledger.ts#L106) |
| `MemoryLedger.evidenceRef(memoryId: string): number \| undefined` | Implements the evidence ref operation. | method | public | [line 110](../../src/evidence-agent/model/memory-ledger.ts#L110) |
| `MemoryLedger.resolveCandidateRefs(refs: readonly number[]): string[]` | Resolves candidate refs. | method | public | [line 114](../../src/evidence-agent/model/memory-ledger.ts#L114) |
| `MemoryLedger.resolveEvidenceRef(ref: number): string` | Resolves evidence ref. | method | public | [line 127](../../src/evidence-agent/model/memory-ledger.ts#L127) |
| `MemoryLedger.selectCandidates(memoryIds: readonly string[]): MemoryCandidate[]` | Implements the select candidates operation. | method | public | [line 138](../../src/evidence-agent/model/memory-ledger.ts#L138) |
| `MemoryLedger.recordSearchHits(hits: readonly RetrievalHit[], step = this.nextStep()): MemoryCandidate[]` | Registers retrieval hits as candidates while preserving first-seen provenance. | method | public | [line 147](../../src/evidence-agent/model/memory-ledger.ts#L147) |
| `MemoryLedger.recordRead(records: readonly MemoryRecord[], step = this.nextStep()): MemoryRecord[]` | Registers exact memory reads and promotes them to eligible evidence. | method | public | [line 173](../../src/evidence-agent/model/memory-ledger.ts#L173) |
| `MemoryLedger.recordBashDiscoveries(records: readonly MemoryRecord[], command: string, step = this.nextStep()): MemoryCandidate[]` | Implements the record bash discoveries operation. | method | public | [line 202](../../src/evidence-agent/model/memory-ledger.ts#L202) |
| `MemoryLedger.acceptSelection(input: PiMemSelection): PiMemSelection` | Validates and stores the agent's final evidence selection. | method | public | [line 220](../../src/evidence-agent/model/memory-ledger.ts#L220) |
| `MemoryLedger.assertInvariants(): void` | Verifies candidate, evidence, citation, and scope provenance invariants. | method | public | [line 302](../../src/evidence-agent/model/memory-ledger.ts#L302) |
| `MemoryLedger.assertScope(record: MemoryRecord): void` | Validates scope and throws when invalid. | method | private | [line 327](../../src/evidence-agent/model/memory-ledger.ts#L327) |
| `MemoryLedger.upsertCandidate(record: MemoryRecord, preview: string, discovery: MemoryCandidate["discoveries"][number]): void` | Implements the upsert candidate operation. | method | private | [line 335](../../src/evidence-agent/model/memory-ledger.ts#L335) |
## `src/evidence-agent/prompts/question-plan.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `cleanMemoryQuestion(question: string): string` | Implements the clean memory question operation. | function | exported | [line 18](../../src/evidence-agent/prompts/question-plan.ts#L18) |
| `inferEvidenceFocus(question: string): EvidenceFocus[]` | Implements the infer evidence focus operation. | function | internal | [line 26](../../src/evidence-agent/prompts/question-plan.ts#L26) |
| `planMemoryQuestion(question: string): MemoryQuestionGuidance` | Implements the plan memory question operation. | function | exported | [line 46](../../src/evidence-agent/prompts/question-plan.ts#L46) |
| `renderMemoryQuestionPlan(question: string): string` | Renders memory question plan. | function | exported | [line 69](../../src/evidence-agent/prompts/question-plan.ts#L69) |
## `src/evidence-agent/prompts/retrieval-guidance.ts`

_No top-level functions, classes, or class methods._
## `src/evidence-agent/run-pimem.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `orderCandidatesForEvidenceAttention(candidates: readonly MemoryCandidate[]): MemoryCandidate[]` | Orders candidate memories for stable evidence review without changing their provenance. | function | exported | [line 50](../../src/evidence-agent/run-pimem.ts#L50) |
| `PiMemRunError` | Implements pi mem run error. | class | exported | [line 96](../../src/evidence-agent/run-pimem.ts#L96) |
| `PiMemRunError.constructor(message: string, diagnostics: PiMemFailureDiagnostics)` | Creates a pi mem run error instance. | method | public | [line 99](../../src/evidence-agent/run-pimem.ts#L99) |
| `questionPrompt(question: string, questionDate?: string): string` | Builds the user prompt from the question and optional question date. | function | internal | [line 106](../../src/evidence-agent/run-pimem.ts#L106) |
| `lastAssistantMessage(messages: readonly unknown[]): AssistantMessage \| undefined` | Returns the final assistant message from the Pi conversation. | function | internal | [line 120](../../src/evidence-agent/run-pimem.ts#L120) |
| `assistantText(message: AssistantMessage \| undefined): string` | Extracts plain text from the final assistant message. | function | internal | [line 137](../../src/evidence-agent/run-pimem.ts#L137) |
| `runPiMem(options: RunPiMemOptions): Promise<PiMemResult>` | Runs one bounded evidence-agent session and returns its provenance-backed result. | function | exported | [line 155](../../src/evidence-agent/run-pimem.ts#L155) |
## `src/evidence-fact-index.ts`

_No top-level functions, classes, or class methods._
## `src/hybrid-search.ts`

_No top-level functions, classes, or class methods._
## `src/ingest.ts`

_No top-level functions, classes, or class methods._
## `src/jsonl-writer.ts`

_No top-level functions, classes, or class methods._
## `src/ledger.ts`

_No top-level functions, classes, or class methods._
## `src/memory/index.ts`

_No top-level functions, classes, or class methods._
## `src/memory/ingest-memory-sessions.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `normalizedKey(key: string): string` | Normalizes d key. | function | internal | [line 49](../../src/memory/ingest-memory-sessions.ts#L49) |
| `assertSafeJson(value: unknown, path: string): void` | Validates safe json and throws when invalid. | function | internal | [line 53](../../src/memory/ingest-memory-sessions.ts#L53) |
| `cloneMetadata(value: Record<string, unknown> \| undefined, path: string): Record<string, unknown> \| undefined` | Implements the clone metadata operation. | function | internal | [line 83](../../src/memory/ingest-memory-sessions.ts#L83) |
| `validateTimestamp(value: string \| undefined, path: string): string \| undefined` | Validates timestamp. | function | internal | [line 95](../../src/memory/ingest-memory-sessions.ts#L95) |
| `recordsForScope(scopeId: string, sessions: readonly MemorySessionInput[]): MemoryRecord[]` | Implements the records for scope operation. | function | internal | [line 107](../../src/memory/ingest-memory-sessions.ts#L107) |
| `ingestMemorySessions(store: MemoryIngestStore, sessions: readonly MemorySessionInput[], options: IngestOptions = {}): Promise<IngestScopeResult[]>` | Deterministic, no-LLM ingest boundary. | function | exported | [line 192](../../src/memory/ingest-memory-sessions.ts#L192) |
## `src/memory/model/memory.ts`

_No top-level functions, classes, or class methods._
## `src/memory/ports/memory-ingest-store.ts`

_No top-level functions, classes, or class methods._
## `src/model.ts`

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
| `asObject(value: unknown, label: string): JsonObject` | Implements the as object operation. | function | internal | [line 57](../../src/platform/pi/load-model-runtime.ts#L57) |
| `asNonEmptyString(value: unknown, label: string): string` | Implements the as non empty string operation. | function | internal | [line 64](../../src/platform/pi/load-model-runtime.ts#L64) |
| `optionalBoolean(value: unknown, fallback: boolean, label: string): boolean` | Implements the optional boolean operation. | function | internal | [line 71](../../src/platform/pi/load-model-runtime.ts#L71) |
| `optionalPositiveInteger(value: unknown, fallback: number, label: string): number` | Implements the optional positive integer operation. | function | internal | [line 83](../../src/platform/pi/load-model-runtime.ts#L83) |
| `optionalCost(value: unknown, label: string): typeof DEFAULT_COST` | Implements the optional cost operation. | function | internal | [line 99](../../src/platform/pi/load-model-runtime.ts#L99) |
| `optionalInput(value: unknown, label: string): ("text" \| "image")[]` | Implements the optional input operation. | function | internal | [line 113](../../src/platform/pi/load-model-runtime.ts#L113) |
| `optionalCompat(providerValue: unknown, modelValue: unknown): OpenAICompletionsCompat \| undefined` | Implements the optional compat operation. | function | internal | [line 125](../../src/platform/pi/load-model-runtime.ts#L125) |
| `validateBaseUrl(value: unknown): string` | Validates base url. | function | internal | [line 152](../../src/platform/pi/load-model-runtime.ts#L152) |
| `parseJsonFile(path: string, label: string): Promise<JsonObject>` | Parses json file. | function | internal | [line 172](../../src/platform/pi/load-model-runtime.ts#L172) |
| `trustedCommand(apiKeyConfig: unknown): string` | Implements the trusted command operation. | function | internal | [line 192](../../src/platform/pi/load-model-runtime.ts#L192) |
| `executeTrustedApiKeyCommand(command: string): Promise<string>` | Executes trusted api key command. | function | internal | [line 209](../../src/platform/pi/load-model-runtime.ts#L209) |
| `loadPiModelRuntime(options: LoadPiModelRuntimeOptions = {}): Promise<PiModelRuntime>` | Loads pi model runtime. | function | exported | [line 236](../../src/platform/pi/load-model-runtime.ts#L236) |
## `src/platform/pi/openai-non-stream-transport.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `resolvedMessageCompat(model: Model<"openai-completions">): MessageCompat` | Resolves the OpenAI message-conversion compatibility settings for a model. | function | internal | [line 56](../../src/platform/pi/openai-non-stream-transport.ts#L56) |
| `requestHeaders(model: Model<"openai-completions">, options: SimpleStreamOptions \| undefined): Headers` | Builds authenticated JSON request headers without persisting the API key. | function | internal | [line 90](../../src/platform/pi/openai-non-stream-transport.ts#L90) |
| `serializedTools(context: Context, compat: MessageCompat): JsonObject[] \| undefined` | Serializes Pi function tools for an OpenAI-compatible request. | function | internal | [line 110](../../src/platform/pi/openai-non-stream-transport.ts#L110) |
| `buildPayload(model: Model<"openai-completions">, context: Context, options: SimpleStreamOptions \| undefined): JsonObject` | Builds a non-streaming Chat Completions request from Pi model context. | function | internal | [line 133](../../src/platform/pi/openai-non-stream-transport.ts#L133) |
| `asObject(value: unknown, label: string): JsonObject` | Validates that an untrusted protocol value is a JSON object. | function | internal | [line 162](../../src/platform/pi/openai-non-stream-transport.ts#L162) |
| `nonNegativeInteger(value: unknown): number` | Normalizes an untrusted usage counter to a non-negative integer. | function | internal | [line 169](../../src/platform/pi/openai-non-stream-transport.ts#L169) |
| `responseUsage(model: Model<"openai-completions">, raw: ChatCompletionResponse["usage"]): Usage` | Maps provider token usage and model rates to Pi usage metadata. | function | internal | [line 177](../../src/platform/pi/openai-non-stream-transport.ts#L177) |
| `responseText(content: unknown): string` | Extracts text from an OpenAI-compatible assistant response. | function | internal | [line 210](../../src/platform/pi/openai-non-stream-transport.ts#L210) |
| `responseThinking(message: NonNullable<ChatCompletionChoice["message"]>): \| { thinking: string; signature: string } \| undefined` | Extracts optional reasoning text and its provider field name. | function | internal | [line 229](../../src/platform/pi/openai-non-stream-transport.ts#L229) |
| `responseToolCalls(value: unknown): ToolCall[]` | Validates and maps complete provider tool calls to Pi tool-call blocks. | function | internal | [line 245](../../src/platform/pi/openai-non-stream-transport.ts#L245) |
| `finishReason(value: unknown, hasToolCalls: boolean): { stopReason: StopReason; errorMessage?: string }` | Maps an OpenAI finish reason to the Pi stop-reason contract. | function | internal | [line 285](../../src/platform/pi/openai-non-stream-transport.ts#L285) |
| `errorMessageFromBody(text: string): string` | Extracts a bounded provider error message from an HTTP response body. | function | internal | [line 306](../../src/platform/pi/openai-non-stream-transport.ts#L306) |
| `emitCompletedMessage(stream: ReturnType<typeof createAssistantMessageEventStream>, message: AssistantMessage): void` | Emits one complete assistant response through the Pi event protocol. | function | internal | [line 321](../../src/platform/pi/openai-non-stream-transport.ts#L321) |
| `openAINonStreamingStreamFn(genericModel, context, options)` | Executes one non-streaming Chat Completions request and exposes it as a Pi event stream. | function | exported | [line 394](../../src/platform/pi/openai-non-stream-transport.ts#L394) |
## `src/platform/security/protected-environment.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `sourceFiles(paths: readonly string[], environment: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv>` | Implements the source files operation. | function | internal | [line 4](../../src/platform/security/protected-environment.ts#L4) |
| `loadProtectedEnvironment(paths: readonly string[], baseEnvironment: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv>` | Loads protected environment. | function | exported | [line 41](../../src/platform/security/protected-environment.ts#L41) |
| `requireEnvironmentVariable(environment: NodeJS.ProcessEnv, name: string): string` | Implements the require environment variable operation. | function | exported | [line 61](../../src/platform/security/protected-environment.ts#L61) |
## `src/platform/sqlite-memory-store.ts`

_No top-level functions, classes, or class methods._
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
## `src/protected-env.ts`

_No top-level functions, classes, or class methods._
## `src/ranking.ts`

_No top-level functions, classes, or class methods._
## `src/request-gate.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval-profile.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval-skill.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval-strategy.ts`

_No top-level functions, classes, or class methods._
## `src/retrieval/adapters/openai/openai-compatible-embedder.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `EmbeddingHttpError` | Implements embedding http error. | class | internal | [line 34](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L34) |
| `EmbeddingHttpError.constructor(status: number, dimensionsUnsupported = false)` | Creates a embedding http error instance. | method | public | [line 38](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L38) |
| `EmbeddingResponseError` | Implements embedding response error. | class | internal | [line 46](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L46) |
| `EmbeddingResponseError.constructor(message: string)` | Creates a embedding response error instance. | method | public | [line 47](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L47) |
| `positiveInteger(value: number, label: string): number` | Implements the positive integer operation. | function | internal | [line 53](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L53) |
| `endpointFor(baseUrl: string): string` | Implements the endpoint for operation. | function | internal | [line 60](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L60) |
| `cleanEmbeddingText(text: string): string` | Implements the clean embedding text operation. | function | exported | [line 79](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L79) |
| `chunkTextBalanced(text: string, maxLength: number): string[]` | Balances chunks by Unicode code point, following PiMem's Unicode code-point contract. | function | exported | [line 85](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L85) |
| `validateVector(vector: unknown, dimensions: number): number[]` | Validates vector. | function | internal | [line 98](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L98) |
| `averageVectors(vectors: readonly number[][], dimensions: number): number[]` | Implements the average vectors operation. | function | internal | [line 114](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L114) |
| `parsePositiveInteger(value: string \| undefined, fallback: number, variable: string): number` | Parses positive integer. | function | internal | [line 131](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L131) |
| `wait(delayMs: number, signal?: AbortSignal): Promise<void>` | Implements the wait operation. | function | internal | [line 141](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L141) |
| `clusterChunks(chunks: readonly string[], batchSize: number): string[][]` | Implements the cluster chunks operation. | function | internal | [line 158](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L158) |
| `OpenAICompatibleEmbedder` | Implements open ai compatible embedder. | class | exported | [line 181](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L181) |
| `OpenAICompatibleEmbedder.constructor(options: OpenAICompatibleEmbedderOptions)` | Creates a open ai compatible embedder instance. | method | public | [line 197](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L197) |
| `OpenAICompatibleEmbedder.fromEnvironment(environment: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch, requestGate?: AsyncRequestGate): OpenAICompatibleEmbedder` | Implements the from environment operation. | method | public | [line 226](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L226) |
| `OpenAICompatibleEmbedder.embedDocuments(texts: readonly string[], options: EmbeddingRequestOptions = {}): Promise<number[][]>` | Implements the embed documents operation. | method | public | [line 268](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L268) |
| `OpenAICompatibleEmbedder.embedQueries(texts: readonly string[], options: EmbeddingRequestOptions = {}): Promise<number[][]>` | Implements the embed queries operation. | method | public | [line 275](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L275) |
| `OpenAICompatibleEmbedder.snapshotMetrics(): EmbeddingMetrics` | Implements the snapshot metrics operation. | method | public | [line 282](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L282) |
| `OpenAICompatibleEmbedder.embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>` | Implements the embed operation. | method | private | [line 286](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L286) |
| `OpenAICompatibleEmbedder.embedCluster(inputs: readonly string[], signal?: AbortSignal): Promise<number[][]>` | Implements the embed cluster operation. | method | private | [line 314](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L314) |
| `OpenAICompatibleEmbedder.requestThroughGate(inputs: readonly string[], includeDimensions: boolean, signal?: AbortSignal): Promise<number[][]>` | Implements the request through gate operation. | method | private | [line 321](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L321) |
| `OpenAICompatibleEmbedder.embedClusterWithRetries(inputs: readonly string[], signal?: AbortSignal): Promise<number[][]>` | Implements the embed cluster with retries operation. | method | private | [line 331](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L331) |
| `OpenAICompatibleEmbedder.request(inputs: readonly string[], includeDimensions: boolean, signal?: AbortSignal): Promise<number[][]>` | Implements the request operation. | method | private | [line 372](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L372) |
| `OpenAICompatibleEmbedder.parseResponse(payload: unknown, inputCount: number): number[][]` | Parses response. | method | private | [line 430](../../src/retrieval/adapters/openai/openai-compatible-embedder.ts#L430) |
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
| `normalizeStrings(values: readonly string[], label: string): string[]` | Validates, trims, and deduplicates a list of search values. | function | internal | [line 53](../../src/retrieval/search-memory.ts#L53) |
| `makeSearchRequest(params: { queries: string[]; limit?: number; sessionIds?: string[]; roles?: MemoryRecord["role"][]; after?: string; before?: string; order?: SearchOrder; maxPerSession?: number; }, defaults: Pick<SearchRequest, "limit" \| "order" \| "maxPerSession"> = {}): SearchRequest` | Builds a normalized retrieval request with stable default limits and ordering. | function | internal | [line 63](../../src/retrieval/search-memory.ts#L63) |
| `searchQueryFingerprint(query: string): string` | Creates a canonical fingerprint used to detect repeated queries. | function | internal | [line 92](../../src/retrieval/search-memory.ts#L92) |
| `mergeOperatorHits(preferred: readonly RetrievalHit[], fallback: readonly RetrievalHit[], limit: number): RetrievalHit[]` | Merges operator-preferred and fallback hits without duplicate memories. | function | internal | [line 101](../../src/retrieval/search-memory.ts#L101) |
| `coverageHits(store: MemoryToolStore, scopeId: string, queries: readonly string[], limit: number, maxPerSession: number \| undefined, signal?: AbortSignal): Promise<RetrievalHit[]>` | Runs each query separately and merges results to preserve multi-query coverage. | function | internal | [line 114](../../src/retrieval/search-memory.ts#L114) |
| `createSearchMemory(options: SearchMemoryOptions): ( params: { operator?: SearchOperator; queries: string[]; limit?: number }, signal?: AbortSignal, ) => Promise<SearchMemoryResult>` | Creates the search orchestrator for normalization, routing, coverage, expansion, and hit merging. | function | exported | [line 167](../../src/retrieval/search-memory.ts#L167) |
## `src/retrieval/temporal-annotation.ts`

| Symbol | Purpose | Kind | Visibility | Source |
|---|---|---|---|---|
| `parseSourceTimestamp(value: string \| undefined): number \| undefined` | Parses source timestamp. | function | exported | [line 4](../../src/retrieval/temporal-annotation.ts#L4) |
| `durationParts(milliseconds: number): string` | Implements the duration parts operation. | function | internal | [line 29](../../src/retrieval/temporal-annotation.ts#L29) |
| `temporalAnnotation(memoryTimestamp: string \| undefined, questionDate: string \| undefined): string \| undefined` | Implements the temporal annotation operation. | function | exported | [line 43](../../src/retrieval/temporal-annotation.ts#L43) |
## `src/runtime.ts`

_No top-level functions, classes, or class methods._
## `src/search-results.ts`

_No top-level functions, classes, or class methods._
## `src/store.ts`

_No top-level functions, classes, or class methods._
## `src/temporal.ts`

_No top-level functions, classes, or class methods._
## `src/timeline-operator.ts`

_No top-level functions, classes, or class methods._
## `src/tools.ts`

_No top-level functions, classes, or class methods._
## `src/types.ts`

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
