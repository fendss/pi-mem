# PiMem：系统总结、当前证据与论文机会

> 状态：内部研究备忘录，2026-08-28
> 目的：总结 PiMem 当前设计与实验事实，区分已经被证据支持的结论、尚待消融的假设，以及最值得投入的论文方向。本文不是对外 leaderboard 声明。

## 0. 一句话结论

PiMem 当前最有价值的地方，不是某个搜索算子单独优于 BM25，也不是已经证明了“算子自进化”，而是一个更基础的设计：**把模型的临时工作上下文与可审计的原始证据状态分离，让 agent 只在上下文中保留导航、覆盖状态和当前计划，而把已读的精确证据提交到不可变 ledger，再交给统一 answer model。**

这条主线有真实的工程实现，也有初步性能信号，但还缺严格的因果消融。当前十任务实验的完成态 macro 为 **86.37%**，把首次 agent 超时直接计 0 后为 **80.45%**。系统在精确事实、事件和事实更新上较强，在细粒度标签体系归纳、跨 session 汇总和偏好整合上较弱；可靠性长尾也仍然明显。因此，最合适的下一步不是继续为个别错题加规则，而是补齐轨迹观测与分层指标，然后验证“上下文—证据分离”“原子算子组合”“无真值覆盖停止”三个通用假设。

## 1. PiMem 现在是什么

PiMem 是一个 query-time agentic memory harness。它不预先把全部历史压缩成一份全局语义摘要，也不要求在写入时猜测未来问题。原始记忆保持可追溯，计算主要发生在问题到来之后。

一道题的主流程如下：

```text
不可变原始记忆
    ↓
retrieval agent 根据问题构造一个或多个查询
    ↓
基础算子返回候选、查询来源与覆盖进度
    ↓
agent 对候选执行 read，读取精确原文片段
    ↓
精确片段进入 evidence ledger；模型上下文仅保留 receipt、working memory 和未读候选
    ↓
agent 单独调用 finish(status, evidenceSummary)
    ↓
固定 answer prompt + ledger 中的原始证据 → 最终回答
```

这实际上形成了两个状态平面：

| 状态平面 | 保存内容 | 设计目的 |
| --- | --- | --- |
| 模型工作上下文 | 当前问题、最新 working memory、查询历史、coverage frontier、已读 receipt、未读候选 preview | 支持下一步搜索和选择，控制上下文增长 |
| evidence ledger | 已 read 的精确原文、source identity、offset、query provenance、自动 citation | 保证最终回答基于可追溯证据，不依赖模型是否一直“记住”原文 |

当前工具职责也相对明确：

- `search` 负责发现候选，不把候选自动视为证据；
- `read` 负责选择并提交精确证据；原始 `READ_RESULT` 只在下一轮展示一次；
- `finish` 只表达检索状态和证据总结，citation 由 ledger 自动生成；它必须作为该轮唯一工具调用，避免模型在尚未看到 `read` 结果时提前总结；
- answer 阶段只消费 ledger 中的 source-grounded evidence，retrieval summary 只具有导航权威，不覆盖原文。

当前底层不是只有一个大而全的“高级算子”。它包含 lexical、hybrid、temporal、numeric 以及 union/intersection/RRF 等可组合能力，并保留多查询命中来源。Skill 的目标是教 agent 围绕 actor、relation、时间、实体别名等构造互补查询，而不是写某个 benchmark 的答案口径。

## 2. 最近完成的关键 harness 修复

与最早的 MVP 相比，当前版本已经解决了一批会直接破坏语义或实验完整性的错误：

1. **上下文调度**：精确 `READ_RESULT` 只展示一次；以后只保留 source receipt。未读候选不会因进入历史区就消失，preview 会依据发现查询再次居中裁剪。
2. **持久工作状态**：最新 working memory、计划与计算显式进入 observation，避免模型只靠聊天历史重建自己的检索进度。
3. **证据不被覆盖**：同一 memory 的多次 projection 按原始 offset 合并，最终 ledger 同时保留各次读到的片段。
4. **finish 契约收缩**：模型不再手工维护 citation 列表；finish 自动引用所有已提交证据。read 在提交前执行容量预检，避免 evidence 超限后 finish 永久失败。
5. **禁止未观察即总结**：`read + finish`、`search + finish` 同轮会阻止 premature finish，让模型先看到工具 observation，再在下一轮完成。
6. **覆盖与来源**：search 返回新/重复候选、新 session、局部无新增路径等 coverage progress；`matchedQueries` 从存储层一直传到 ledger。
7. **组合算子正确性**：bounded union 不再被第一个子搜索占满，改为 round-robin 合并；显式 session cap 使用 breadth-first admission 后仍允许同 session 的第二、第三条证据。
8. **HTTP 与恢复**：协议、预算、超时、provider failure 使用 typed error；服务有全局并发门控；artifact 原子保存，retrieval 完成后恢复不会重复 ingest 或重跑已经完成的阶段。

当前本地验证为 TypeScript typecheck 通过、**50 个测试文件 / 283 项测试全部通过**。

## 3. 当前十任务实验

### 3.1 配置与边界

- 数据：MemoryAgentBench 选定十个子集，共 1600 题；EventQA-64K 为 500 题，LongMemEval-S 为 300 题，其余每项 100 题。
- retrieval controller：GPT-5-mini，medium reasoning，4096 输出预算。
- answer model：GPT-5-mini，medium reasoning，4096 输出预算。
- LongMemEval judge：官方口径 GPT-4o，temperature 0。
- 每题最多 8 次 search；64 turns、80 tool calls、单次 agent run 300 秒。
- 服务最大 128 个并发 wrap；十个任务并行、每任务 24 个 query slots。
- 本轮内部模式名为 `static`：它表示**固定内置算子目录**，不是“非 agentic 静态记忆”。1600 题均没有动态 operator definition，因此本轮不能作为算子自进化的证据。
- 应用户的工程调试要求，`retrieval_agent_timeout` 会保存审计记录并只续跑超时题；真实作答无论对错都不重跑。

### 3.2 主结果

“完成态”是所有题最终获得真实 answer 后的分数；“严格首轮”把任何首次 retrieval-agent 超时的题直接计 0，更接近不允许 retry-until-success 的论文口径。

| 任务 | 能力 | N | 完成态 | 严格首轮 | 不同超时题 | 平均 search | `insufficient` |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Banking77 | test-time learning | 100 | 92.0% | 92.0% | 0 | 1.56 | 1% |
| CLINC150 | test-time learning | 100 | 92.0% | 91.0% | 1 | 2.35 | 16% |
| EventQA-64K | accurate retrieval | 500 | 97.0% | 95.2% | 9 | 2.15 | 17% |
| Fact-MH-6K | conflict resolution | 100 | 89.0% | 86.0% | 3 | 3.77 | 54% |
| Fact-SH-6K | conflict resolution | 100 | 100.0% | 96.0% | 4 | 2.51 | 20% |
| LongMemEval-S | accurate retrieval | 300 | 74.7% | 72.3% | 12 | 3.49 | 48.3% |
| NLU | test-time learning | 100 | 91.0% | 87.0% | 6 | 2.93 | 26% |
| RULER-QA1 | accurate retrieval | 100 | 89.0% | 84.0% | 5 | 2.71 | 16% |
| TREC-Coarse | test-time learning | 100 | 84.0% | 63.0% | 27 | 5.17 | 48% |
| TREC-Fine | test-time learning | 100 | 55.0% | 38.0% | 34 | 6.41 | 66% |
| **十任务 macro** | — | — | **86.37%** | **80.45%** | — | — | — |
| **问题加权 micro** | — | 1600 | **87.56%** | **83.13%** | **101** | **3.04** | **29.8%** |

补充运行事实：

- 126 次 agent-level 超时尝试涉及 101 道题；其中 20 道至少超时两次，单题最多超时 4 次。
- 101 道曾超时的题中，最终有 71 道答对。这解释了完成态和严格首轮之间的明显差距。
- 129/1600 题用满 8 次搜索。系统总体平均 3.04 次，不是所有题都受搜索上限约束。
- query wall time 的 P50/P95 为 200.7/726.1 秒，最大 1983.8 秒；这些数字包含恢复与 provider 等待，不能解释为纯算法延迟。
- artifact 还记录了 1364 次 retrieval HTTP retry 和 581 次 answer HTTP retry。高并发吞吐已经跑通，但上游可用性仍是当前实验成本的重要组成部分。
- 整个续跑 suite 观察上约 39 分钟完成；这是工程吞吐结果，不是标准化 latency benchmark。

### 3.3 LongMemEval-S 细分

| 类型 | 正确/总数 | 准确率 |
| --- | ---: | ---: |
| knowledge-update | 37/45 | 82.2% |
| temporal-reasoning | 57/75 | 76.0% |
| multi-session | 47/75 | 62.7% |
| single-session-assistant | 29/30 | 96.7% |
| single-session-preference | 14/30 | 46.7% |
| single-session-user | 40/45 | 88.9% |
| **总体** | **224/300** | **74.7%** |

在 LME 中，retrieval agent 自报 `sufficient` 的 155 题准确率为 85.8%，`insufficient` 的 145 题为 62.8%。这说明检索前沿与停止状态包含有用信号，但还不能当成校准置信度：TREC-Coarse 的 `sufficient`/`insufficient` 准确率反而是 82.7%/85.4%，Fact-SH 两组都是 100%。

### 3.4 历史 LongMemEval 结果不能与本轮混写

历史上，与 ReFind/STITCH S50 协议对齐的 `session-coverage-v1 + budget8` 单次运行达到 **47/50（94.0%）**；其中 multi-session 15/17，temporal 11/11。ReFind 报告的是相同固定 S50 上五次 **93.2 ± 3.3**。PiMem 的 94.0 说明该设计有达到强基线的能力，但只有一次，且不是当前最新 harness 的重跑，不能据此宣称稳定超过 ReFind。

另一个历史 `observation-v5` 原始 LongMemEval 500 题运行是 **433/500（86.6%）**，其中 answerable 90.2%、multi-session 82.0%、preference 63.3%。它与本轮 MemoryAgentBench LME(S*) 300 题在题集、judge 和 harness 版本上均不同，因此 86.6% 与 74.7% 不能直接解释为同一实验的回退。正确做法是在代码冻结后，对最新版本重新跑同一 S50 五次和同一 500 题一次。

## 4. 与官方论文结果应如何比较

MemoryAgentBench 官方表中，GPT-5-mini long-context 在 SH-QA、LME(S*)、EventQA、五项 MCC 平均、Fact-SH、Fact-MH 上分别为 85.0、63.3、78.2、84.0、78.0、28.0。当前 PiMem 中较接近的参考是：RULER-QA1 89.0、LME(S*) 74.7、五项分类 macro 82.8。LME 的信号是积极的，分类平均则没有超过 long context；但 provider、reasoning、提示与失败处理未完全 matched，因此目前只能作为定位，不应写成正式 superiority claim。

EventQA-64K 比官方约 534K 的完整 EventQA 更短；Fact-SH/MH 是 6K，而主表是 262K，不能直接比较。官方短上下文验证中 GPT-4o/O4-mini 在 Fact-SH-6K 为 92/100，Fact-MH-6K 为 28/80；PiMem 的 100/89 显示短上下文冲突消解已很强，但 backbone 不同，也不是公平排名。

ReFind 的 MemoryAgentBench 主表使用 GPT-4o-mini controller/answer，在完整六任务上为 58.2 macro；其 LME 为 51.3、EventQA 为 74.1。当前 PiMem 使用 GPT-5-mini medium，不能拿 74.7 或 97.0 直接声称击败 ReFind。真正可比的是 GPT-5-mini S50 协议，而那里目前只有 PiMem 单次 94.0 对 ReFind 五次 93.2 ± 3.3，仍需重复实验。

## 5. 当前瓶颈的证据化判断

### 5.1 精确事实和更新不是当前主要短板

EventQA-64K 97%、Fact-SH-6K 100%、Fact-MH-6K 89%，说明原始记忆保真、局部事件检索和“新事实覆盖旧事实”已经能工作。继续为这类题堆更多语义规则，边际收益可能较低。

### 5.2 TREC-Fine 暴露的不是普通 top-k 召回问题

TREC-Fine 只有 55%，平均搜索 6.41 次，44 题用满 8 次，66 题以 `insufficient` 结束。该任务要求从大量带标签例子中归纳一个 50 类映射，再把新问题映射到数值标签。它需要的是**分布式示例覆盖和 schema induction**，而不是找到一条与问题字面最相似的记忆。TREC-Coarse 只有 6 类，准确率上升到 84%，但仍有明显超时长尾。这是“检索系统不应把所有 memory 问题都建模为点查询”的直接证据。

目前 artifact 只保存最终 `retrievalStatus/searchCalls`，没有保存成功轨迹的完整 candidate/read/ledger，因此还不能断言 TREC-Fine 的 45 个错误分别有多少属于候选未召回、候选已召回但未 read、已 read 但 evidence 选错、或 answer 映射错误。缺少这层分解，是下一轮实验前必须先补的观测缺口。

### 5.3 LongMemEval 仍是跨 session 与开放式偏好的短板

single-session-assistant 达到 96.7%，single-session-user 为 88.9%，而 multi-session 只有 62.7%、preference 46.7%。这符合历史错题观察：单个明确 slot 容易闭合；跨多个 session 的列表、计数、时间顺序和相关偏好需要判断“还缺什么”，没有 ground truth 时很难知道检索是否完整。

### 5.4 `sufficient` 还不是可靠停止器

LME 中它与正确率相关，但在 TREC-Coarse 和 Fact-SH 中不校准。当前 coverage progress 能描述本次 query 是否产生新 candidate/session、是否填满窗口，却不能证明开放集合已经完整。研究问题不是再写一条“多搜几次”的 Skill，而是如何从 novelty、query diversity、session coverage、候选稳定性和预算代价中得到可迁移的停止准则。

### 5.5 可靠性会改变结论

完成态 macro 86.37% 与严格首轮 80.45% 相差 5.92 个百分点；TREC-Coarse/Fine 的差距尤其大。无限 retry 适合把系统跑通、保住已经完成的 token，但正式论文必须同时报告固定预算单次尝试、timeout rate、LLM calls、token、P50/P95 latency，以及可恢复完成态。否则算法准确率会和 provider 可用性混在一起。

## 6. 最有希望的论文方向

### 方向 A（优先级最高）：Evidence-first agentic memory harness

**核心命题**：agent 不需要把所有已读 memory 长期留在模型上下文；它只需要保留可操作的导航状态和自己的最新 working memory。精确 evidence 应保存在外部、不可变、可审计的 ledger，并在 answer 阶段重新注入。

**现有证据**：当前系统已经按此运行，能在 1600 题上完成端到端测评；历史 S50 单次达到 94%。最新 observation 修复也解决了“read 后原文挤满上下文、总结未保存、旧候选消失”等真实错误。

**尚缺证据**：还没有 matched ablation 证明这种分离相对“raw 永久留在上下文”“summary-only note”“候选直接交给 answer”更准或更省 token。ReFind 已经有 `take_note`，所以论文的新意不能只写成“agent 会记笔记”，而应明确落在 source-grounded exact evidence、一次性 observation、自动 provenance 与工作上下文调度。

**关键消融**：固定检索模型、answer model、预算和题集，只替换状态管理：

1. full PiMem：一次性 raw + receipt + exact ledger；
2. sticky raw：每次已读原文永久保留在 controller context；
3. summary-only：只保留模型摘要，不保留 exact ledger；
4. no-read：搜索候选直接作为 answer context；
5. no-working-memory：移除显式计划/coverage，仅保留工具聊天历史。

同时报告 answer accuracy、candidate/read/ledger recall、controller input tokens、重复 read、finish error、timeout 和 citation faithfulness。如果 full PiMem 在准确率相当或更高时显著降低 controller token 与协议失败，这会是一条完整、通用且不依赖 benchmark trick 的论文主线。

### 方向 B：从点检索到 workload-adaptive memory access

**核心命题**：memory query 至少包含点事实检索、冲突更新、多跳组合、开放集合聚合和 schema induction；同一套“相似度 top-k”不可能在所有 workload 上最优。agent 应先识别问题需要的证据结构，再组合通用原子操作，而不是为每个数据集增加一个专用高级工具。

**现有证据**：Event/Fact 很强，TREC-Fine 很弱；LME 的 closed-slot 明显好于 multi-session/open-set。性能差异与任务所需证据结构一致。

**实验设计**：在相同 controller 下比较：单次 BM25、单次 hybrid、多轮原子查询组合、带 union/intersection/RRF 的组合、以及允许通用 `group/sample/filter` 原子操作的版本。按任务类型画 accuracy–search calls–tokens 曲线，并检查 agent 是否真正组合操作，而不是只重复同一种 search。所有 operator catalog 在测试集前冻结，禁止把数据集名称或 gold 标签写进 Skill。

### 方向 C：无 ground truth 的 coverage frontier 与停止决策

**核心命题**：开放集合和跨 session 任务的主要难点不是生成更多查询，而是判断证据何时足够。可用 query novelty、candidate/session 增量、重复率、rank 稳定性和已覆盖语义槽构造一个任务无关的检索前沿。

**现有证据**：LME 的 sufficient/insufficient 有 23.0 点准确率差，但该信号跨任务不校准；129 题耗尽 8 次搜索，其中 TREC-Fine 占 44 题。

**实验设计**：先持久化每轮 frontier，再用离线 gold evidence 只做评估，不提供给 agent。衡量每种信号对“下一次搜索还能否发现新 gold evidence”的 AUC、停止时 recall、额外搜索成本和最终准确率。在若干任务上调阈值、在未见任务上验证，才能证明它不是 benchmark-specific coverage hack。

### 方向 D：算子自进化，但必须放在 held-out 协议里

当前 1600 题全部使用 static catalog、动态 operator definition 为 0，所以“自进化提高了性能”目前没有实验证据。这个方向仍可做，但必须把学习边界设计清楚：

- `static`：固定基础算子；
- `ephemeral`：仅在单题内部生成组合，题后丢弃；
- `cumulative`：只从历史问题与无 gold 的执行信号积累 operator；
- dev task 上允许演化，held-out task 前冻结 operator catalog hash；
- 对照同等搜索/LLM/token 预算，记录每个 operator 的出生、复用、淘汰和跨任务迁移。

只有 cumulative 在 held-out context/task 上稳定优于 static/ephemeral，且增益不能由更高 token 或更多搜索解释，才适合写“self-evolving memory operators”。

### 方向 E：可靠性与 anytime agentic retrieval

PiMem 的 checkpoint、幂等 ingest、pending answer 恢复和 typed failure 已经形成了系统基础。可以把它提升为研究问题：给定 wall-time/LLM-call 预算，agent 何时返回当前最佳 evidence，何时继续搜索，失败恢复后结果是否保持语义等价。

但该方向更像系统论文的第二贡献，不宜掩盖检索方法本身。正式实验应画 accuracy–wall time–cost frontier，并把 provider retry 与 agent decision time 分离。

## 7. 开始论文实验前必须补的观测

下一轮不要先扩大 benchmark，而应让每道题可被分层归因。成功 artifact 至少需要保存不含敏感原文的结构化轨迹：

1. 每轮 query、operator、candidate ID/rank、`matchedQueries` 和 session；
2. preview 中实际展示的 source offset；
3. read 的 candidate、exact source offset、evidence ref；
4. finish 时 ledger 的 evidence refs、status、summary；
5. retrieval/answer 的分阶段 token、wall time、retry 与错误码。

然后定义一条 failure funnel：

```text
gold/source 是否进入 candidate
→ 关键内容是否在 preview 可见
→ agent 是否选择 read
→ exact evidence 是否进入 ledger
→ answer model 在正确 ledger 下是否答对
```

这能把“算子没召回”“observation 把信息裁掉”“模型选错 evidence”“answer 生成错误”分开。对于没有现成 gold evidence 的任务，可以抽样人工标注，或使用可控合成数据；不能用最终答案反向提示在线 agent。

## 8. 推荐的实验顺序

| 优先级 | 实验 | 实验动机 | 论证逻辑 | 成功标准 |
| --- | --- | --- | --- | --- |
| P0 | 轨迹与 failure funnel | 当前只能看到最终状态，无法定位召回/选择/回答 | 先让每次失败可归因，后续消融才可信 | 绝大多数错误能落入互斥阶段 |
| P1 | 上下文—ledger 五组消融 | 验证最核心架构贡献 | 只改变状态表示，其他全部固定 | full 在准确率、token、超时或证据忠实度上形成 Pareto 优势 |
| P2 | search budget 1/2/4/8 | 分离“agent 组合”与“只是搜索更多” | 画任务分项 accuracy–cost 曲线 | 多轮在跨 session/多跳上有稳定边际收益 |
| P3 | 基础算子与组合消融 | 验证是哪个访问能力带来增益 | BM25/dense/hybrid/temporal/numeric/union 等逐项控制 | 增益跨任务、非某道题规则 |
| P4 | controller × answer 模型析因 | 探索 harness 的基模能力边界 | answer 固定时换 controller；gold ledger 下换 answer | 找出证据选择与回答能力的独立下限 |
| P5 | static/ephemeral/cumulative held-out | 验证自进化而非泄漏 | 训练边界、catalog hash、预算完全审计 | cumulative 在未见任务上重复显著提升 |
| P6 | 五次重复与可靠性曲线 | 解决 agent 自由决策方差和超时 | 固定问题集，报告 mean/std、单次失败与恢复态 | 结论不依赖最好单次 |

## 9. 现在可以写与不能写的结论

### 已有证据支持

- PiMem 已经是可运行的 evidence-first agentic memory harness，而不是只有概念接口。
- 固定内置算子、GPT-5-mini controller/answer 的当前版本能完成十任务 1600 题，并在事件检索和短上下文事实更新上表现较强。
- 当前主要弱点集中在细粒度 schema induction、跨 session 汇总、偏好整合和 agent 长尾可靠性。
- 历史 S50 单次 94% 表明 PiMem 有达到强 agentic memory 基线水平的潜力。

### 目前不能写

- 不能写“PiMem 已稳定超过 ReFind”；缺少当前冻结版本的五次 matched run。
- 不能把历史 86.6% 当成当前最新 harness 的 full-LME 成绩。
- 不能写“自进化算子有效”；本轮没有产生任何动态 operator。
- 不能用完成态 86.37% 隐去 101 道首次超时；论文必须同时报告严格首轮和恢复态。
- 不能断言 TREC-Fine 只是召回失败；成功轨迹尚未保存到足以完成 failure funnel。
- 不能从十任务 macro 声称 MemoryAgentBench 总榜 SOTA；选取子集、长度和 backbone 与官方主表并不全部匹配。

## 10. 推荐论文叙事

当前最稳妥的主标题方向是：

> **PiMem: Evidence-First Agentic Memory with a Decoupled Working Context and Immutable Evidence Ledger**

主张顺序应是：

1. 长期记忆 agent 的 controller context 同时承担导航、原文保存和回答证据，导致上下文膨胀、状态丢失与不可审计；
2. PiMem 将其拆成轻量 working context 与 source-grounded evidence ledger，并通过 search/read/finish 契约连接；
3. agent 在原子检索操作上进行问题驱动组合，ledger 向固定 answer stage 提供可验证证据；
4. 在多类增量记忆任务上，通过状态表示消融、检索组件消融和 backbone 析因，证明准确率—token—可靠性的收益及边界。

如果后续 held-out 实验真的证明 cumulative operator evolution 有收益，可以把它升级为第二主贡献；在此之前，它更适合作为展望，而不是论文标题。

## 11. 结果与来源位置

- 当前十任务 artifact：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-harness-frontier-v3-gpt5mini-10task-r2-20260827/runs/harness-frontier-v3-gpt5mini-medium-budget8-r2`
- 当前 LME 官方 GPT-4o judge：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-harness-frontier-v3-gpt5mini-10task-r2-20260827/evaluation/gpt4o-official/longmemeval-s-static.json`
- 历史 S50 47/50：`/data/zhaogangyi/pi-mem-eval/refind-protocol-20260824/full-native-session-coverage-v1-budget8-s128-s50-run1/evaluation/refind-judge/summary.json`
- 历史 full-500 433/500：`/data/zhaogangyi/pi-mem-eval/refind-protocol-20260824/full-native-observation-v5-lme-s500-budget4-composite-s128-run1/evaluation/refind-judge/summary.json`

## 参考文献

1. Hu et al. *Evaluating Memory in LLM Agents via Incremental Multi-Turn Interactions*. ICLR 2026 / [arXiv:2507.05257](https://arxiv.org/abs/2507.05257).
2. *When Your Agent Opens the Chat App: Agent-Controlled Search over Raw Chat Logs Rivals Structured Memory*. [arXiv:2608.12888](https://arxiv.org/abs/2608.12888).
