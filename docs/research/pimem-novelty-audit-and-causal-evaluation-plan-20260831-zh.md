# PiMem 创新性审计与最低因果验证计划

> 状态：内部研究文档，2026-08-31
>
> 目的：把 PiMem 当前真实机制、已完成的 LME-S300 消融、2024--2026 年最近一手工作和最低可发表实验放在同一条 claim--evidence 链上。
>
> 结论先行：production E0 auto-handoff 的 fresh online strict full-300 为 **247/300（82.33%）**；唯一一次 retrieval method timeout 直接计 0、没有 retry。相对 matched inline 239/300，E0 单次净增 8 题（both-correct 222、E0-only 25、inline-only 17、both-wrong 36，+2.67 pp），但双侧 exact McNemar **`p=0.279956`**，尚不能称稳定提升。E0 将 E1 clean strict 234/300 的 aggregate 回退恢复到 247/300，且 fixed-trace E0/E1 也为 176/227 vs 169/227；这些证据共同反对 explicit commit，但两个 online run 的 13 题差值不是纯 commit 因果估计。E0 的 stage 信号是 no-gold/partial-candidate 从 inline 的 8/25 降到 0/6，同时 `candidate_all_not_read` 从 36 增到 58；但随后 98 题 fixed-trace 诊断表明，把首次搜索前 4 个未读 parent 盲目加入 answer evidence，在这 58 题上仅从 34/58 变为 35/58（3/4 flips，`p=1`），在其中原始错误的 22 题上仍为 2/22（2/2 flips，`p=1`），且 answer prompt tokens 增加 49.5%。因此“候选已可见却未被 read”是可观察漏斗，却不是“少给四条 evidence”这一简单因果解释；剩余问题更可能涉及 query-conditioned semantic selection 与 answer synthesis，二者尚未隔离。当前仍没有足够证据声称方法创新；blanket auto-inspect 不能合入 production，最多只剩 candidate visibility / memory-specific physical view 的跨数据集系统诊断空间。

## 0. 结果口径

本文区分三种证据：完整 benchmark 的正式结果、定向冻结集或 oracle 的诊断结果，以及明确写成 `TBD` 的待完成结果。三者不能互相替代。

| 对象 | 当前状态 | 可否作为论文结果 |
| --- | --- | --- |
| `inline-compose-v2`，旧 `read=commit` 机制，MemoryAgentBench LongMemEval-S 300 | **239/300（79.67%）** | 可以作为诊断起点，不代表当前新机制 |
| 冻结 paired-84：旧 baseline → evidence-transaction/reservoir V1 | **40/84 → 52/84，净 +12 题**；15 个旧错题转对，3 个 correctness guard 转错 | 可以报告为定向、单次、配对回归证据；不能外推为 300 题总体增益，也不能分解到某个组件 |
| 同一 paired-84：V1 → Skill coverage V2 | **52/84 → 49/84**；3 题转对、6 题转错，净 -3 | 可以报告为单次 matched negative result；不能据此断言该 Skill 普遍有害 |
| 同一 paired-84：V1 → two-layer candidate directory V3 | **52/84 → 57/84**；10 gains、5 losses，双侧 exact McNemar `p=0.3018`；guards 均为 37/40，failure targets 15/44 → 20/44 | 只可作为当时启动 full-300 的方向性 signal；E1 后续为负，E0 后续单次正向但未显著，效果依赖 evidence boundary |
| 历史 255/300 版本在同 84 个 ID 上的回看结果 | **65/84**（28/44 failure targets，37/40 guards） | 仅说明历史可达水平和当前剩余 headroom；memory scope、ingestion、宏算子、搜索预算及 176/300 个 question date 不同，不能作为受控 A/B |
| V1/V2/V3 的 mixed 300 aggregate | judge 文件分别显示 **251/300**、**248/300**、**256/300**，但 216 行沿用旧 baseline，仅 84 行重新运行和重判 | **都不是正式 300 题结果，不得作为方法成绩** |
| 13 题 gold-only B/C 回答消融 | B（原 exact evidence、无 summary）5/13；C（gold-only exact evidence、无 summary）9/13 | 只可作为 evidence narrowing 的 oracle diagnostic，不能作为可部署 selector 的准确率 |
| clean full-300：two-layer directory + E1 explicit commit | 原始 judge artifact **235/300**；两题 retrieval method timeout 严格计 0 后 **234/300（78.0%）** | 234/300 是应报告口径；原始 235 仅用于复核 artifact，不能覆盖 method failure |
| 上述 clean E1 与 inline 239/300 | 严格口径低 **5 题（-1.67 pp）**；原始 artifact 配对为 final-only 20、inline-only 24、`p=0.6516` | 不支持 directory + explicit commit 提高总体 QA；`p=0.6516` 只对应修正前 235 artifact，不能冒充严格口径检验 |
| fresh online production E0 full-300 | **247/300（82.33%）**；299 条 retrieval 成功，1 个 method timeout 直接计 0 且无 retry | 可以作为严格、单次、完整 benchmark result；不是多次运行均值 |
| production E0 vs matched inline | **222 both-correct / 25 E0-only / 17 inline-only / 36 both-wrong**；净 +8、+2.67 pp、双侧 exact McNemar `p=0.279956` | 正向但不显著；不能写“稳定提升”或“优于 inline 已成立” |
| 历史 best full-300 | **255/300（85.0%）** | accuracy-only non-matched reference；300/300 完整 datetime 不同、176/300 calendar date 不同，成本也不可比 |
| fixed-trace 227 fresh E0/E1 answer ablation | E0 all-inspected **176/227（77.5%）**；E1 explicit-commit **169/227（74.4%）**；E0-only 14、E1-only 7、`p=0.1892` | 条件于同一 retrieval trace 的 answer-handoff 因果证据；不是端到端 300 题分数。方向不支持 E1 准确率收益 |
| fixed-trace E1 prompt compression | 227 题 E0/E1 answer prompt UTF-8 bytes 总量 **2,082,900 → 407,197（-80.5%）** | 支持输入压缩，不等于 token、latency 或准确率改善 |
| fixed-trace candidate read-burden A/B | 98 题 = 完整 `candidate_all_not_read` 58 题（原 judge 36 对/22 错）+ 40 题 `all_gold_read_answer_correct` guard。58 题 A/B 为 **34/58 vs 35/58**、3/4 flips、`p=1`；原始错误 22 题为 **2/22 vs 2/22**、2/2 flips、`p=1`；guard 为 **38/40 vs 39/40**、1/2 flips、`p=1` | gold 只用于 eligibility/分层，B 的 top-4 选择不使用 gold；这是 fixed-trace 诊断，不是 full-300，且不支持 blanket auto-inspect |
| fixed-trace top-4 成本 | B 相对 A：answer prompt tokens **+49.5%**、answer-call total tokens **+44.7%**、mean answer latency **+4.9%** | 支持该诊断臂增加 answer 侧负担；不能外推为 online full-system 成本 |
| production E0 题型分层 | multi 61/75、temporal 65/75、knowledge-update 40/45、assistant 29/30、user 41/45、preference 11/30 | 单次描述性结果；相对 inline 的净变化分别为 +6、+3、-1、-1、+3、-2，不能挑正向题型包装总体结论 |

mixed aggregate 的算术是 `251 = 199 个未重跑的 baseline-correct control + 52 个 V1 paired-84 correct`，`248 = 199 + 49`，`256 = 199 + 57`。它们之所以有 300 行，是 resume/judge seed 保留了 216 个旧答案，并不表示 V1、V2 或 V3 完整执行了 300 题。因此，251/300、248/300 和 256/300 仍不得进入 Abstract、主结果表或 SOTA 对比。

clean full-300 则确有 300 个 fresh prediction 和 300 个唯一 wrap audit，但“行数完整”不等于“方法成功完整”。运行中两次 `retrieval_agent_timeout` 被旧 resume 行为重新采样，judge artifact 因而仍对后续答案打分；严格方法评估应把这两题在首次 method failure 处终止并计 0。两题中只有一题的后续答案被 judge 判对，所以原始 235 修正为 234，而不是 233。当前 runner 已改为：非重试型 retrieval/answer method failure 写入空 prediction、保留在分母且 resume 不再重采样；只有 typed infrastructure failure 可以在冻结边界上恢复。这个发现与修复属于**测评完整性/工程卫生**，不能包装成 PiMem 方法创新。

fresh E0 formal run 验证了修复后的严格语义：300 题从空 artifact 启动，299 题产生 nonempty answer，唯一 retrieval method timeout 直接作为空 prediction 计 0，resume 没有重采样。因而 247/300 不需要像 E1 raw 235 那样事后扣分。它与 inline 的 source rows 完全 matched；历史 255 仍有 300/300 full timestamp mismatch、176/300 calendar-date mismatch，只能作为 non-matched accuracy reference。

## 1. PiMem 当前真实机制

### 1.1 当前运行时状态机

clean full-300 使用的是 E1 explicit-commit 实验版本；fixed-trace 负结果后，production 已回退为 E0。当前代码中的合法状态转移是：

```text
search result
  -> candidate C
  -> read(C): inspected exact evidence E, retained in the read ledger
  -> finish(status, evidenceSummary): every inspected E is auto-committed
  -> benchmark answerer receives all read exact records
```

具体实现边界如下：

- `src/evidence-agent/model/memory-ledger.ts` 明确写为 `candidate -> read exact evidence -> automatically committed evidence`；raw record 只能来自 structured store result，不能由模型文本构造；
- `src/evidence-agent/adapters/pi/tools/read-tool.ts` 仍返回稳定 E handle、精确内容和 source hash，但明确告知每个 read source 会在 finish 成功时进入最终 evidence package；
- `src/evidence-agent/adapters/pi/tools/finish-tool.ts` 的 schema 只有 `status` 与 `evidenceSummary`，不再接收 `evidenceRefs` 或 `selectedMemoryIds`；finish 从 ledger 读取全部 inspected evidence 并统一提交；
- citation、hash、source identity 和 provenance 由 harness 根据 ledger 生成，模型不能通过自由文本伪造来源；
- `finish` 仍记录 compact `evidenceSummary` 作为 retrieval artifact；当前 LongMemEval answer adapter 只序列化 exact records，不把该 summary 放入 answer prompt。

因此，**inspect/commit 分离已不是当前 production 机制**。E1 仍可作为已冻结的实验实现被复核，但不能在 Method 中写成当前系统事实，更不能在 fixed-trace 结果方向为负之后继续把它列为创新候选。当前可审计性质来自 stable refs、exact-source ledger、hash 与 provenance，而不是模型显式选择最终 evidence subset。

### 1.2 当前 search 还不是严格的 semantic-query-only 接口

当前 `search` schema 仍允许 Agent 提供：

- 一个或多个自然语言 `queries`；
- 可选 `operator`；
- 可选 retrieval branches 与 `rrf/union/intersection`；
- role filter、排序、session cap 和可见 limit。

因此，**“Agent 当前只表达 semantic need，完全不接触物理计划”并不是现状**。当前真实状态是：Agent 可以表达语义查询，也可以显式控制一部分物理操作；harness 同时执行以下固定物理策略：

1. hybrid 路径对每条 query 执行 dense 与 lexical retrieval，并进行融合；
2. 内部 candidate reservoir 最深 80 条；初次观察最多给出 20 条 full-passage findings，并把同一物理排序中的其余候选作为 compact、可直接 `read(C-ref)` 的 directory entries；
3. `search_more` 只把同一 reservoir 的下一批 compact directory entries 展开为 full passages，不执行新检索，也不消耗新的 semantic-search call；
4. 在 `pimem-hybrid` 路径上，当 Agent query 中出现唯一、合法、显式的 `YYYY-MM-DD` 日期时，harness 增加受约束的 timestamp route；它不会猜测多日期的范围语义，纯 lexical operator 也不触发该 route；
5. 所有 candidate、metadata filter 和 read expansion 都进入 provenance ledger。

所以，本文后续所说的“semantic-query-only + physical planner”是一个**待验证实验臂**，不是可以直接写进当前 Method 的既成事实。当前 80-depth reservoir、20 条 full finding + compact directory 的 two-layer observation、可直接读取的 C refs 和窄日期 route 可以写成已实现机制。它们与 production E0 组成的 online bundle 得到 247/300，相对 matched inline 单次 +8，但 `p=0.279956` 且 retrieval 成本显著增加；因此只能称方向性 systems signal。由于当前 search 仍暴露物理控制，而且 bundle 同时改变 candidate visibility、metadata route 与运行协议，directory/physical planner 的独立效应仍未知。

### 1.3 当前机制与待验证研究对象

为避免混写，使用以下状态表：

| 设计项 | 代码状态 | 已完成研究证据 | 论文 claim 状态 |
| --- | --- | --- | --- |
| hidden reservoir 80 + 20 full findings + compact readable directory | 已实现 | E1 clean strict 234/300；production E0 clean strict 247/300 vs matched inline 239，+8、`p=0.279956`；候选与 tokens 成本大增 | 有方向性 aggregate 与 stage 机制证据；独立效应、显著性和效率均未成立 |
| `pimem-hybrid` 单个显式日期的 metadata route | 已实现 | 1 道严格 counterfactual 恢复 | 只能称机制，不可称普遍有效 |
| E0：read ledger 全部在 finish 时 auto-commit | **当前 production** | fixed-trace 227 为 176/227；fresh online strict full-300 为 247/300，1 method timeout 直接计 0 | 可写当前实现与单次结果；不能写稳定显著提升 |
| E1：read 仅 inspect、`finish(refs)` 选择提交 | 已完成实验实现，已从 production 回退 | fixed-trace 227 为 169/227，对 E0 为 7 gains/14 losses、`p=0.1892`；prompt UTF-8 bytes -80.5% | 只可写负结果/压缩 trade-off；不再是创新候选 |
| answer 只消费 exact records，不消费自由文本 summary | 已实现 | 13 题 B/C 显示 gold-conditioned narrowing 动机；fixed-trace E1 未改善准确率 | exact-source handoff 是系统选择，不证明 selector 创新 |
| runtime provenance 与 ref 校验 | 已实现并有测试 | 证明协议约束，不证明方法新颖性 | 可作为系统性质 |
| Agent 严格只表达 semantic need | 尚未成为唯一接口 | 无受控结果 | `TBD`，只能作为实验因素 |
| learned planner / learned selector | 未实现 | 无 | 不得声称 |
| blanket top-4 unread-parent auto-inspect | 仅完成 fixed-trace 诊断，未进入 production | 58 题 34→35、原始错误 22 题 2→2、guard 38→39，三组 `p=1`；prompt tokens +49.5% | 不支持合入 production，也不是创新候选 |

## 2. 已完成消融到底证明了什么

本节同时纳入深入消融报告与后续冻结 paired-84 回归。每项结果都按实际实验单位报告，不把事后 oracle、定向回归集或 seed-mixed artifact 改写成当前完整方法性能。

### 2.1 召回深度、CandidateSet 与 metadata route

**实验动机。** 判断 20 道 gold 未完整进入 candidate 的错题，究竟需要新的 CandidateSet dataflow，还是已有 Agent query 下的物理召回深度与 metadata 执行不足。

**论证逻辑。** 固定 Agent 当时产生的 query、role 和 scope，不重新生成查询；比较 hybrid/lexical 的不同深度、per-query union、RRF、session breadth、邻居扩展和以 candidate content 为输入的二次检索。Gold 只用于离线评分。

**实验效果。** 实际可见结果是 0/20 完整覆盖；同一批 query 在 hybrid top-40、top-60、top-80 分别达到 12/20、15/20、17/20；per-query hybrid top-100 unbounded union 达到 19/20，但平均 268.5 个候选，只是可达性上界。candidate-dependent 邻居或二次检索的独占恢复为 0/20。剩余 1/20 在不增加 gold 词的情况下，把 Agent 已写出的 `2023-03-15` 下推为当天 timestamp window 后，使 gold 在 hybrid top-20 排名第 4。

因此，按“每题可选择事后已验证的 corpus-first 物理访问路径”计，这 20 道已知 recall failure 达到 **20/20 可达**：19 题来自宽池 union，1 题来自日期 metadata route。这个 20/20 是两个离线 counterfactual 的并集，不是单一、budget-matched、在线可执行 arm；其中 19 题的 arm 平均暴露 268.5 个候选，也没有经过 Agent 选择和最终回答。它只能支持“答案仍存在于当前 corpus-first substrate 的可达空间”，不能写成 recall@20、planner accuracy 或端到端 20/20。

这一结果支持：

- 当前主要 recall 损失更像物理深度、分页与停止问题；
- 没有证据支持把 CandidateSet 复杂操作暴露给 Agent 是当前主解；
- metadata route 值得验证，但只有一个严格样本，不能宣称已解决 temporal retrieval；
- top-80 和 unbounded union 不是端到端 planner 成绩。

### 2.2 candidate 可见但未提交

**实验动机。** 检查 6 道形式上的 candidate-not-committed 错题是否都可由“更好的 evidence selection”修复。

**论证逻辑。** 逐题比较可见 preview、实际 read、finish handoff 与最终 answer，判断补读遗漏 gold 是否会改变最终答案。

**实验效果。** 只有 3/6 是可确认的 selection-causal 错误；另外 3 道分别属于 answer 违背 handoff、答案表达/coverage 过度保守和 evidence synthesis 错误。因此，不能把 6/6 全部记为新 commit 协议的潜在收益。

### 2.3 已提交 gold 后仍答错：summary 与 ledger 噪声

**实验动机。** 判断 13 道 gold 已全部提交但答案错误的题，是纯 answer model 错误，还是 retrieval summary 和不可逆 evidence accumulation 已经污染了 answer input。

**论证逻辑。** 对比错误组与正确组的 committed evidence 数和 prompt 长度，并构造两个反事实回答臂：B 保留当时全部 exact sources 但移除 summary；C 仅保留事后 gold exact sources 且移除 summary。Answer model 和 judge 配置保持相同。

**实验效果。** 错误组平均 committed memories 为 11.38，正确组为 5.31；平均 prompt 字符分别为 15,723 与 7,958。B 恢复 5/13，C 恢复 9/13；paired outcomes 为 both-correct 4、B-only 1、C-only 5、both-wrong 3，故 C 相对 B 净 +4。B 的 evidence package 平均含 11.38 个 exact sources、15,185 个 prompt 字符，C 降为 2.23 个 sources、1,479 个字符。

这是当前最直接的 evidence-package 机制证据：在 summary 都关闭时，gold-only narrowing 比保留全部已提交 exact records 多恢复 4 题。但 B 没有 fresh A，B/C 也是单次随机生成，C 使用 benchmark gold source，无法部署。它不隔离 summary 的独立效应，也不证明当前 Agent 能学会选择同样的最小证据集。

这一结果当时支持检验 evidence narrowing，也支持 LongMemEval answer prompt 不再消费自由文本 retrieval summary；但后续 fixed-trace E1 为 169/227、低于 E0 的 176/227，说明 gold-conditioned oracle narrowing 不能外推为可部署 explicit selector。它仍可作为错误归因证据，不能继续作为 inspect/commit 方法收益的证据。

### 2.4 V1 frozen paired-84：bundle 有净正向信号

**实验动机。** 在不重跑全部 300 题的前提下，检验 evidence transaction、hidden reservoir、exact-only handoff 和窄 metadata route 组成的 V1 bundle，能否修复已知错误而不大幅破坏旧正确题。

**论证逻辑。** 冻结集包含旧 `inline-compose-v2` 的 44 个非 preference failure targets，以及从 239 个 baseline-correct 题中按题型分层、确定性抽样的 40 个 correctness guards。模型、数据版本、ingestion checkpoint、answer/judge prompt、搜索预算和 judge 均固定；84 个 ID 重新执行，其余 216 行只用于 resume 兼容。

| paired-84 arm | Failure targets | Correctness guards | 合计 |
| --- | ---: | ---: | ---: |
| 旧 baseline | 0/44 | 40/40 | **40/84** |
| V1 evidence-transaction/reservoir bundle | 15/44 | 37/40 | **52/84** |

V1 相对旧 baseline 有 15 个 wrong→correct、3 个 correct→wrong，净 **+12 题**。这是冻结定向设计下的 bundle-level 因果信号，比 post-hoc oracle 更强，说明该 bundle 值得继续验证；但它仍只有一次随机生成，而且 84 题有意富集旧错误，不能估计完整 300 题分布上的平均增益。V1 同时改变多个因素，不能把 +12 单独归因于 reservoir、inspect/commit、去 summary 或 metadata route。

**Non-matched historical reference.** 历史 255/300 版本在相同 84 个 ID 上为 **65/84**（28/44 failure targets，37/40 guards），比 V3 高 8 题，说明这批题仍有明显 headroom。由于其 memory scope、ingestion、宏算子、预算和 question date 不同，这个 65/84 必须与 matched V1/V2/V3 结果分开，只能作为回看 reference，不能参与 V3 的因果 delta 或显著性比较。

### 2.5 V2 Skill coverage：matched 单次结果未改善

**实验动机。** 检验在 retrieval Skill 中显式维护多信息需求 coverage note、完成前逐项核对 premise，能否减少 evidence omission。

**论证逻辑。** V1 与 V2 的 source checksum diff 中，唯一会影响运行时决策的文件是 `.agents/skills/pimem-retrieval/SKILL.md`；另一个变化是不会进入运行时的 `test/runtime.test.ts`。数据、ingestion、模型、prompt pins、搜索预算、84 个 ID 和 official judge 相同。因此，V1→V2 是本次运行内较干净的 Skill-level matched causal contrast；但它仍是单次随机运行，V2 还经历了可恢复的 provider retry，不能把观测差异当作稳定平均效应。

**实验效果。** V2 在相同 84 题上为 **49/84，低于 V1 的 52/84**；逐题有 3 个 V1-wrong→V2-correct，同时有 6 个 V1-correct→V2-wrong，净 -3。最诚实的结论是：“coverage Skill 在本次 matched paired-84 中没有改善 V1，并出现净回退。”不能写成“coverage reasoning 有效”，也不能凭一次 -3 写成“coverage Skill 普遍有害”。

### 2.6 V3 two-layer candidate directory：曾通过 promotion gate，后续效果依赖 evidence boundary

**实验动机。** V1 的 80-depth reservoir 只把前 20 条显示为 full findings；V3 将其改成 two-layer observation：保留最多 20 条 full-passage findings，同时把同一物理检索的深层候选暴露为 compact、可直接读取的 C-ref directory，检验深池可见性是否能转化为回答收益。

**论证逻辑。** V3 与 V1 使用同一 84-ID manifest、ingestion、retrieval/answer model、搜索预算和 official judge；source delta 集中在 candidate directory 的 retrieval、search tool、tool contract 与 observation renderer（另有两处对应测试），active Skill 保持 V1 版本。主比较预先限定为 84 个 fresh paired rows，216 个 seeded rows 排除。除最终 QA 外，同时检查题型分层、retrieval-agent token 成本，并对 V3-only 正确题做 post-hoc gold trace，要求观察到 directory 中的 gold 被 `read`、被 `finish` commit 且最终判对，才计为直接机制链。

**实验效果。** V3 得到 **57/84**，相对 V1 的 52/84 有 10 gains、5 losses，净 +5；双侧 exact McNemar **`p=0.3018`**，因此方向为正但没有越过常用显著性门槛。V1 与 V3 的 correctness guards 均为 **37/40**，failure targets 从 **15/44 提高到 20/44**。全部净增都来自 temporal-reasoning（13/24 → 18/24，净 +5）；multi-session 均为 15/29，其他题型也无净增。retrieval-agent mean tokens 从 25,351 增到 33,891，约 **+34%**；该统计不含 answer-model tokens，因此不能声称总成本只增加 34%。

在 10 个 V3-only 正确题中，6 个读取过初始 directory、5 个初始 directory 含 gold、4 个提交了 directory memory，只有 **3 个**同时满足“directory gold→read→commit→correct”。因此 paired-84 当时只能说“至少 3 题具有与预期机制一致的完整 trace”；其余 7 个 gains 可能来自搜索、选择、answer 或单次采样差异，不能全部归因于 directory。综合效果、`p` 值、题型集中和成本，V3 当时只满足**启动 full-300** 的工程 promotion gate。后续 E1 strict 234 低于 inline，E0 strict 247 单次高于 inline 但未显著，说明该信号强烈依赖 answer-visible evidence boundary，不能被改写为 directory 的独立稳定收益。

### 2.7 Clean full-300：目录链存在，但总体得分未提高

**实验动机。** 检验 paired-84 上的 V3 方向性信号能否外推到未富集的完整 300 题分布，并把目录曝光、读取、提交、最终回答与成本放在同一条 trace 上。

**论证逻辑。** 从空结果文件运行 300 个 fresh query/answer rows，取得 300 个唯一 wrap audits；使用冻结 ingestion、gpt-5-mini retrieval/answer、official gpt-4o judge 与目录 + E1 运行时。主比较为同 300 ID 的 inline-compose-v2 239/300。历史 255/300 仅作 accuracy-only reference，因为其生成设置和 question datetime 不匹配。结果完整性另按“method failure 最终计 0”审计，不以 resume 后成功答案覆盖首次方法失败。

**实验效果。** 原始 official-judge artifact 为 **235/300（78.33%）**。运行审计发现两题发生 `retrieval_agent_timeout` 后被旧 resume 行为重新采样；严格把两题都计 0 后为 **234/300（78.0%）**。由于两题中只有一条后续答案原先判对，严格修正只减少 1 个 correct。应报告的当前 clean 结果是 234/300，低于 inline 的 239/300 共 5 题（-1.67 pp）。原始 235 artifact 的配对统计为 both-correct 215、directory/E1-only 20、inline-only 24、both-wrong 41、双侧 exact McNemar `p=0.6516`；这些 flip 与 `p` 没有按严格失败口径重算，不能与 234 拼成同一组统计结论。历史 255/300 的 300/300 完整 question datetime 不同，176/300 calendar date 不同，且成本不可比，仍不是 matched baseline。

原始 artifact 的 stagewise funnel 揭示了“召回改善被 evidence selection 损失抵消”的结构：

- 以 inline stage 分组，22 个 `gold_committed_answer_wrong` 中目录/E1 回答恢复 8 个，8 个 `no_gold_candidate` 中恢复 5 个；但 199 个 inline `gold_committed_answer_correct` 中只有 180 个在新版本仍答对。
- 最明显的 transition 是 48 题从 inline `gold_committed_answer_correct` 变成新版本 `candidate_not_committed`：inline 为 48/48，新版本只有 33/48，净损 15。相反，15 题从 inline `gold_committed_answer_wrong` 进入新版本 `candidate_not_committed` 时恢复 5 题，5 题从 `no_gold_candidate` 进入 `gold_committed_answer_correct` 时全部恢复。
- 新版本最终共有 115 题落在 `candidate_not_committed`，只答对 68/115；158 题落在 `gold_committed_answer_correct`，为 158/158。这个漏斗直接提示 explicit selection omission，而不是证明 directory 无召回价值。

目录 trace 也显示局部机制确实发生：300/300 暴露过 directory-origin candidate，92 题直接读取目录 ref，49 题提交目录 ref；50 题目录含 gold，26 题读取该 gold，21 题读取并提交，最终 15 题判对。在原始 artifact 的 20 个 directory/E1-only correct 中，5 题目录含 gold、4 题读取、3 题读取并提交且最终正确；在 24 个 inline-only correct 中，6 题目录含 gold、3 题读取、1 题提交，但没有一题形成“directory gold→read→commit→correct”。这是 trace linkage，不是 directory 的平均因果效应；最重要的总体事实仍是 **该 E1 full-300 分数没有提高**。

成本同样没有形成免费改进。相对 inline，新版本每题平均候选从 26.9 增至 90.3，directory refs 从 0 增至 72.0，retrieval-agent tokens 从 23,645 增至 30,205（约 +27.7%），平均 query time 从 127.8 秒增至 179.1 秒，P90 从 203.2 秒增至 306.7 秒。最终 answer evidence 数从 6.77 降至 1.68（约 -75.2%），但 evidence package 变窄并没有抵消 retrieval 侧成本或提高准确率。以上成本来自完成后的 raw artifact，包含被重新采样的 timeout 行，不是严格 first-attempt 成本估计。

### 2.8 Fixed-trace E0/E1：显式 commit 压缩 prompt，但准确率方向为负

**实验动机。** clean full-300 同时改变目录可见性与 evidence commit，无法判断失分来自物理召回还是 E1 selection。需要固定 retrieval trace，只改变 answer-visible evidence set，直接隔离 explicit commit。

**论证逻辑。** 从 clean run 的 300 条 trace 中，预先选择“all first-seen read memory IDs 的集合与 committed memory IDs 集合不同”的 227 题；选择规则不使用 gold，另有 9 条只改变顺序的 trace 排除在主效应外。对每题从同一 trace 构造 E0（全部 inspected exact records，按首次 read 顺序）和 E1（原 explicit committed exact records）两个 answer prompt；两臂都不放入 retrieval summary/status，使用同一 gpt-5-mini answer 配置，各 fresh 生成一次并由同一 official judge 评分，共 454 次成功 answer call。

**实验效果。** E0 为 **176/227（77.53%）**，E1 为 **169/227（74.45%）**，E1-E0 为 -3.08 pp。配对结果为 both-correct 162、E0-only 14、E1-only 7、both-wrong 44，双侧 exact McNemar **`p=0.1892`**。差异未达常用显著性门槛，但方向与“explicit commit 提高准确率”相反，且 14:7 的 flip 不能被写成正向或等价性结论。

E1 的确显著压缩输入：227 个 answer prompt 的 UTF-8 字节总量从 E0 的 2,082,900 降到 407,197，减少 **80.5%**，均值约从 9,176 降到 1,794 bytes。不过实验没有报告 tokenizer 后的 answer input tokens、latency 或价格，因此只能称 prompt-byte compression。鉴于准确率方向为负，production 已回退 E0；E1 最多可作为 accuracy--compression trade-off 的负结果或可选效率模式，不再是方法创新候选。

### 2.9 测评完整性漏洞与修复

**实验动机。** 防止方法超时被 resume 后的新采样“洗掉”，使完整性统计、分母和最终 accuracy 真实对应一次冻结方法运行。

**论证逻辑。** 对齐 service operation audit、run rows、resume 规则和 judge artifact，区分 non-retryable method failure 与 typed retryable infrastructure failure。前者必须写入空 prediction、保留在分母且永不重采样；后者只能从记录的可恢复边界继续。

**实验效果。** clean run 暴露了两次 retrieval method timeout 被旧 resume 行为覆盖的漏洞，严格重算把 raw 235 修正为 234。当前 runner、测试和文档已加入 non-retryable method failure 的 final-zero 语义以及 resume 不重排队约束。这个修复提高的是结果可信度，不改变检索、选择或回答机制，**不得列为方法贡献或创新点**。

### 2.10 Fresh online E0：恢复 aggregate 方向，但单次 +8 尚不显著

**实验动机。** E1 clean strict 234/300 与 fixed-trace E0 176/227 > E1 169/227 都指向 explicit evidence omission。需要用当前 production E0 做一次从 retrieval 到 answer 的 fresh online full-300，确认 auto-handoff 是否能在真实闭环中恢复总体表现，并使用修复后的 strict method-failure 规则。

**论证逻辑。** 从空 artifact 启动 300 题，不复用 smoke、seed、旧 prediction、judge 或 audit；使用当前 E0 `inspected = committed = answer evidence` 协议、相同 frozen source rows 与 official judge。唯一 retrieval method timeout 作为 non-retryable method failure 直接写入空 prediction并计 0，不 retry。主对照为 source-matched inline 239/300；历史 255/300 仍因生成日期与系统配方不匹配而只作 accuracy reference。

**实验效果。** E0 得到 **247/300（82.33%）**，相对 inline 的 239/300 净 +8（+2.67 pp）。配对结果为 both-correct 222、E0-only 25、inline-only 17、both-wrong 36，双侧 exact McNemar **`p=0.279956`**。这是正向单次观测，没有越过常用显著性门槛；不能写成“E0 稳定优于 inline”。历史 255/300 高 8 题，但 300/300 full timestamp、176/300 calendar date 不同，不能参与因果比较。

题型结果同时包含 gains 与 regressions，不能只挑正向子集：

| Question type | E0 current | Inline | Delta correct |
| --- | ---: | ---: | ---: |
| multi-session | 61/75 | 55/75 | +6 |
| temporal-reasoning | 65/75 | 62/75 | +3 |
| knowledge-update | 40/45 | 41/45 | -1 |
| single-session-assistant | 29/30 | 30/30 | -1 |
| single-session-user | 41/45 | 38/45 | +3 |
| single-session-preference | 11/30 | 13/30 | -2 |

Gold-stage funnel 更直接地定位了剩余瓶颈：

| Gold stage | E0 current | Inline | Delta |
| --- | ---: | ---: | ---: |
| no gold candidate | 0 | 8 | -8 |
| partial gold candidates | 6 | 25 | -19 |
| all gold in candidates, not all read | 58 | 36 | +22 |
| all gold read, answer wrong | 20 | 22 | -2 |
| all gold read, answer correct | 205 | 199 | +6 |
| unresolved gold mapping | 10 | 10 | 0 |
| method failure timeout | 1 | 0 | +1 |

E0 的宽 candidate visibility 把 `no_gold_candidate` 从 8 降到 0、`partial_gold_candidates` 从 25 降到 6，但 `candidate_all_not_read` 从 36 增到 58。也就是说，召回/可见性问题明显收缩后，**可见 gold 没有被完整 read** 成为最大的可定位漏斗。205 题在 all-gold-read 后回答正确、20 题读全仍答错，说明 answer synthesis 也仍是可见失败阶段；这些 stage counts 不能确定 selection 与 synthesis 的因果优先级，且两者都不能由继续加深 candidate pool 自动解决。

E0 的 aggregate 恢复伴随明显 retrieval 成本；E0 的资源均值按 299 条 retrieval-completed rows 计算，inline 按 300 条计算，method-timeout 行没有被伪装成零成本成功行：

| Mean per query | E0 current | Inline | 解释边界 |
| --- | ---: | ---: | --- |
| candidates | 94.17 | 26.91 | 约 3.50×；不是 budget-matched planner gain |
| retrieval-agent tokens | 32,706 | 23,645 | 约 +38.3%；不含 answer tokens |
| search calls | 1.73 | 1.45 | 约 +19.5% |
| answer evidence count | 6.32 | 6.77 | 基本相近，E0 并非靠更窄 evidence 获益 |
| mean query latency | 96.84 s | 127.80 s | 原始观测更低，但 provider/concurrency 条件不同，不能作因果效率 claim |
| P90 query latency | 179.56 s | 203.17 s | 同上，只能描述 artifact |

E0 online 247 比 E1 strict 234 高 13 题，且 fixed-trace E0/E1 的 14/7 flips 方向一致，因此可以诚实写“移除 explicit commit 后 aggregate performance 恢复”。但两个 online runs 的 retrieval trajectories、并发和采样并非同一固定 trace，**13 题差值不能单独归因于 commit**。当前最窄的支持结论是：explicit commit 没有得到准确率支持；E0 + wide visibility 有值得复验的单次正向信号；代价高，且最大的可定位漏斗已经从 candidate absence 转为 candidate-not-read。下一项 fixed-trace 诊断进一步表明，这个漏斗不能用 blanket top-4 auto-inspect 简单修复。

### 2.11 Fixed-trace candidate read burden：blanket top-4 auto-inspect 无可靠收益

**实验动机。** fresh E0 的 58 题落在 `candidate_all_not_read`，明显高于 inline 的 36。需要直接检验最简单的解释：问题是否只是 Agent 少 read 了物理排序靠前的少数可见候选，若把它们自动交给 answerer 就能稳定恢复错误。

**论证逻辑。** 实验冻结 fresh E0 retrieval trace，纳入完整的 58 题 `candidate_all_not_read` stage（原 official judge 36 对、22 错；没有 wrong-only 过滤）以及 40 题 `all_gold_read_answer_correct` guard，共 98 题。A 使用保存的 current E0 exact-read prompt，98/98 与原 prompt byte-exact；B 在相同 prompt 上加入**首次成功 search 的 full-page display order 中前 4 个未读 parent**，不重新搜索，不使用 gold 选择 evidence，并通过冻结的 production `projectMemoryEvidenceBatch` 投影 exact records。Gold 只用于 eligibility 与预注册分层。两臂各 fresh 生成 98 个 answer，再由同一 official judge fresh 评分；196 个 answer 与 196 个 judge 成功输出均为首个 attempt，无基础设施恢复或成功输出丢弃。

**实验效果。** 主结果没有显示可靠收益：

| Fixed-trace slice | N | A：current exact read | B：A + first-search top-4 unread parent | A-only / B-only | Exact McNemar |
| --- | ---: | ---: | ---: | ---: | ---: |
| 完整 `candidate_all_not_read` stage（原 judge 36 对/22 错） | 58 | **34/58** | **35/58** | 3 / 4 | `p=1` |
| 上述 stage 中预注册的原始错误层 | 22 | **2/22** | **2/22** | 2 / 2 | `p=1` |
| `all_gold_read_answer_correct` guard | 40 | **38/40** | **39/40** | 1 / 2 | `p=1` |

B 同时明显增加 answer 侧负担：prompt tokens 从 227,650 增到 340,434（**+49.5%**），answer-call total tokens 从 257,813 增到 372,980（**+44.7%**），平均 answer latency 从 5.55 s 增到 5.82 s（**+4.9%**）。这些是同一 fixed-trace answer A/B 的观测成本，没有做成本差异显著性检验，也不是 online retrieval/full-system 成本。

因此没有证据把 blanket top-4 auto-inspect 合入 production：在最关心的 22 个原始错误上，净恢复为 0，且少量 gain/loss 双向抵消。该结果否定的是“candidate 已可见但未 read = 只差四条物理靠前 evidence”这一简单解释；它没有证明某一种 query-conditioned selector 或 answer synthesis 方法必然有效，也没有区分两者。若继续，研究对象必须转为 query-conditioned semantic selection/learned selector（learnware 方向）或更干净、预算匹配的 physical view，并先在第二数据集预注册验证；继续加候选或 blanket auto-read 不应进入下一 production 迭代。

### 2.12 已完成结果的证据边界

当前可以写：

- 在已知 20 道 recall failure 上，离线组合的 corpus-first 访问路径达到 20/20 可达，但不是单一在线 arm；
- candidate-dependent 程序没有独占恢复这些题；
- 13 道 gold-committed 错题中，gold-only C 为 9/13、current-evidence B 为 5/13，paired 净 +4；
- V1 bundle 在定向 paired-84 上从 40/84 提升到 52/84，净 +12；
- coverage Skill V2 的单次 matched 结果为 49/84，低于 V1 的 52/84；
- V3 在同一 paired-84 上为 57/84，相对 V1 方向性净 +5，guards 不变；收益集中于 temporal，retrieval-agent tokens +34%；
- 至少 3 个 V3-only 正确题具备 directory gold→read→commit→correct 的直接 trace；
- clean full-300 directory+E1 严格为 234/300，低于 inline 239/300；目录形成了 15 个 gold-read-commit-correct trace，但没有提高总体分数；
- fixed-trace 227 上 E0 为 176、E1 为 169，7/14 flips、`p=0.1892`；E1 prompt bytes -80.5%，但准确率方向为负；
- fresh online E0 strict 为 247/300，相对 matched inline 239/300 单次 +8、`p=0.279956`；题型有正有负，历史 255 仍 non-matched；
- E0 stagewise 从 inline 的 no-gold/partial 8/25 降到 0/6，但 candidate-all-not-read 从 36 增到 58；这支持“可见但未 read 是最大的可定位漏斗”，不证明它是单一原因；
- fixed-trace read-burden 诊断在完整 58 题 stage 上为 34/58 vs 35/58，在原始错误 22 题上为 2/22 vs 2/22，guard 为 38/40 vs 39/40，三组 `p=1`；blanket top-4 还使 answer prompt tokens +49.5%、total tokens +44.7%；
- E0 平均 candidates 94.17、retrieval tokens 32,706、search 1.73，均高于 inline 的 26.91、23,645、1.45；现有证据只支持跨数据集检验 query-conditioned selection / cleaner physical view，不再支持 explicit commit 或 blanket auto-read 创新候选。

当前不能写：

- physical planner 已提高 LME-S300；
- `finish(evidenceRefs)` 已提高 LME-S300；
- explicit commit 在固定 trace 下优于 auto-commit，或 80.5% bytes 压缩等于 token/latency/成本收益；
- metadata pushdown 普遍改善 temporal reasoning；
- V1 的 +12 可以归因于任一单组件，或可外推为完整 300 题 +12；
- V2 已证明 Skill coverage 普遍降低性能；
- V3 已显著优于 V1、directory 导致全部 10 个 gains，或 +34% 是完整系统总成本；
- clean E1 为 235/300 而不披露两次 method timeout 和严格 234/300；
- production E0 已稳定或显著优于 inline；目前只有一次 +8 且 `p=0.279956`；
- E0 的 +8 是 budget-matched physical-planner gain，或较低 raw latency 是方法导致；候选、tokens、search budget 更高且并发/provider 条件会影响 latency；
- E0 online 相对 E1 online 的 +13 可全部归因于 auto-handoff；只有 fixed-trace 227 才直接隔离 E boundary；
- candidate-all-not-read 的 58 题证明“只要自动加入前 4 个未读候选就会恢复”，或 blanket top-4 应合入 production；fixed-trace 主层只净增 1，原始错误层净增 0，且成本上升；
- 20/20 oracle 可达、5/13 或 9/13 是可部署方法的端到端提升；
- mixed artifact 的 251/300、248/300 或 256/300 是当前方法正式成绩。

## 3. 2024--2026 一手文献 claim--evidence 审计

下表优先使用论文、作者官方仓库或项目官方实现。MemGPT 为理解 Letta 所需的 2023 年基础例外。

| PiMem 候选 claim | 最近的一手覆盖 | 审计判断 |
| --- | --- | --- |
| Agent 多轮搜索、查看原始聊天、收集证据后回答 | [ReFind](https://arxiv.org/html/2608.12888) 使用 raw chat、迭代 keyword search、局部扩展、时间约束、saved notes 和独立 answer stage；其论文明确说单个设计轴都不新。[A-RAG](https://arxiv.org/abs/2602.03442) 向 Agent 暴露 keyword search、semantic search 和 chunk read | 已覆盖；search/read loop、raw-log refinding 和多工具组合不能称创新 |
| retrieval intent 与 backend execution 分离 | [LogicalRAG](https://arxiv.org/html/2605.27123) 已把 agentic RAG 定义为 interface-control problem，要求 LLM 表达 intent、backend 忠实执行，并让 Agent broaden/tighten/exclude | 高层思想已覆盖；PiMem 只能研究不同的 control locus：物理决策是否应隐藏在 harness 内 |
| 宽召回后构造窄证据 | [DeferMem](https://arxiv.org/html/2605.22411) 明确拆为 high-recall candidate retrieval 与 query-conditioned evidence distillation；[LazyMem](https://arxiv.org/html/2607.22690) 提出 retrieve broadly, construct selectively；[Nano-Memory](https://arxiv.org/html/2604.11628) 用 QDP 清理跨 session 和 session 内噪声 | 已直接覆盖；宽召回、窄展示或 query-conditioned pruning 不能单独称创新 |
| temporal/metadata filtering | [LongMemEval](https://arxiv.org/html/2410.10813) 已使用 time-aware query expansion 缩小检索范围；ReFind 有 Agent-controlled temporal narrowing；[Letta 官方工具](https://github.com/letta-ai/letta/blob/main/letta/functions/function_sets/base.py) 的 archival search 支持 semantic query、tags、top-k 和时间范围 | metadata pushdown 是已知机制；只能研究“约束由谁表达、谁验证、如何避免误过滤” |
| adaptive operator、memory structure 或 evidence subset selection | [MESA](https://arxiv.org/html/2608.10108) 学习选择 summary、temporal store、KG、vector DB 与 raw episodic trace 的子集；[Adaptive-RAG](https://arxiv.org/abs/2403.14403) 和 [Search-R1](https://arxiv.org/abs/2503.09516) 已研究 learned retrieval/controller | generic adaptive routing 和 learned selection 已覆盖；PiMem 当前不能暗示自己是 learned planner |
| staged evidence collection 和 source-grounded answer | ReFind 已有 inspect、take-note、finish-search；[PaperQA2 论文](https://arxiv.org/abs/2409.13740) 与[官方仓库](https://github.com/Future-House/paper-qa)已有 search、gather evidence、answer 和带来源回答 | 一般的 evidence staging 与 citation 已覆盖；PiMem 的 explicit read-side commit 又被 fixed-trace 负方向否掉，不能再作为候选创新 |
| transactional memory | [MemTX](https://arxiv.org/html/2607.23929) 已提出 snapshot-isolated、validate-and-commit、provenance 和 machine-checked invariant 的 transactional belief commit | “transactional memory” 总称已被占用；production E0 也不再执行模型选择式 commit，应从主叙事移除该术语 |
| provenance、citation、source attribution | ReFind 保留 verbatim saved-note trace；PaperQA2 生成带来源回答；[LightRAG 官方仓库](https://github.com/HKUDS/LightRAG)已有 citation/source attribution | generic provenance 或 citation 不新；runtime-enforced lineage 只能作为系统性质 |
| 新 memory representation 或 storage architecture | [MemGPT](https://arxiv.org/abs/2310.08560)/Letta 提供层次化可编辑 memory；[Mem0](https://arxiv.org/abs/2504.19413) 做写侧事实抽取、整合和检索；[GraphRAG](https://arxiv.org/abs/2404.16130) 与 [LightRAG](https://arxiv.org/html/2410.05779) 构造图式 retrieval substrate | PiMem 当前不是新的 storage representation；这些更适合作为可插拔后端或背景，而不是最直接 baseline |

## 4. 哪些不能再称为创新点

无论后续分数多高，以下表述都应从 Abstract、Introduction 和标题中删除：

1. “首次让 Agent 多轮搜索长期记忆”；ReFind、A-RAG、MemGPT/Letta 等已覆盖。
2. “首次宽召回、窄展示”；DeferMem、LazyMem、Nano-Memory 已直接覆盖。
3. “首次使用 metadata/time pushdown”；LongMemEval、ReFind 和 Letta 已覆盖。
4. “首次把 retrieval 和 answer 分开”或“首次收集 evidence 再回答”；ReFind、PaperQA2 已覆盖。
5. “首次提供 provenance/citation”；这是已有系统能力。
6. “首个 transactional memory”；MemTX 已直接占据该术语，而且研究对象是更强的持久 belief commit。
7. “新型 learned retrieval planner/controller”；PiMem 当前没有学习 planner。
8. “新型多结构或可组合 memory operator”；MESA、A-RAG 及大量 agentic RAG 已研究选择与组合。
9. “当前 Agent 只表达 semantic query”；当前 tool schema 仍暴露 operator、branch、combine、order 等控制。
10. “PiMem 已稳定超过 ReFind”或“达到 SOTA”；尚无冻结版本、matched judge/backbone/budget 和多次运行结果。
11. “explicit evidence commit 提高准确率”或“inspect/commit 是本文核心创新”；fixed-trace E1 为 169/227，低于 E0 的 176/227，production 也已回退 E0。
12. “发现并修复 method-timeout 计分漏洞是方法创新”；这只是必须完成的 evaluation integrity 工作。

可以保留的工程性质包括 exact-source lineage、opaque refs、非法 candidate/read ref 拒绝、hidden pagination 和完整 trace；除非它们在公平实验中产生新知识，否则不能自动升级为方法创新。

## 5. 当前仅剩的研究问题：query-conditioned evidence utilization / physical view 系统诊断

### 5.1 可证伪研究问题

E1 clean、fixed-trace E0/E1 与 fresh online E0 已否掉原先“physical control + explicit commit 联合边界”的主要叙事，同时留下一个更窄的问题：E0 单次达到 247/300，但 +8 不显著且用掉更多 retrieval 资源；stage funnel 又显示 58 题的 gold 已在 candidate 中却未被完整 read。进一步的 fixed-trace read-burden A/B 已经否掉最简单的处理：盲目加入首次搜索前 4 个未读 parent，在 58 题上只从 34 到 35，在原始错误 22 题上完全没有净恢复，却使 answer prompt tokens 增加 49.5%。当前值得检验的问题因而收缩为：

> 在 E0 auto-handoff、相同模型与严格预算下，query-conditioned semantic selection 或更干净的 memory-specific physical view，能否把可见 candidate **转化为充分、低噪声的 answer evidence 与最终 QA**，而不是继续扩大 candidate pool、blanket auto-read、tokens 和 search calls？

这仍只是 control-locus / evidence-utilization hypothesis，不是新 retriever hypothesis。E0 的 no-gold/partial stage 从 inline 的 8/25 降到 0/6，说明宽 visibility 有机制效果；但 candidate-all-not-read 增到 58、总分 +8 未显著、retrieval tokens +38.3%，而 blanket top-4 又没有可靠收益，说明“更多可见候选”还不是净方法收益。剩余工作必须改善 query→selection→synthesis 的转化和 QA/成本 frontier，不能继续增加 reservoir 或自动 read 后宣称问题已解决。

### 5.2 目标形式化

给定不可变历史 `H`、问题 `q` 和 Agent 在第 `t` 轮表达的语义需求 `s_t`：

- physical planner `P` 产生隐藏候选池 `R_t = P(H, s_t)`；
- harness 只展示有界页面 `V_t ⊆ R_t`；
- `read` 把 Agent 选择的 candidate 解析为精确、不可变的 inspected evidence set `I`；
- production E0 在 finish 时令 `C = I`；
- answerer 只消费 `q` 与 exact `C`，不把 navigation summary 当作事实来源。

协议要求保持：

```text
Committed = Inspected ⊆ Retrieved-or-explicitly-expanded
```

目标是在固定候选计算、检索调用和 Agent-visible token 预算下，提高 hidden-pool→visible→read→answer 的转化率和最终 QA，并完整报告 retrieval cost。若只提高 hidden-pool recall 或目录曝光而不提高 QA，结果应被解释为 stagewise diagnostic，而不是 planner improvement。

### 5.3 还可能有什么新意，以及边界有多窄

- ReFind/A-RAG 把较多物理控制交给 Agent；PiMem 候选方向把物理编译移到 harness。
- LogicalRAG 也区分 intent 与 execution，但 Agent 表达的是显式逻辑约束；PiMem 候选方向只让 Agent 表达自然语言 information need。
- DeferMem/LazyMem 学习 query-time distillation/compression；PiMem 候选方向是 training-free、保留 exact raw records，不重写 evidence。
- ReFind/PaperQA2 已有 evidence collection；PiMem 保留机器生成的 exact-source lineage，但不再主张模型显式 commit。
- MemTX 的 write-side persistent transaction 与 PiMem 当前 E0 read ledger 更无直接方法重合；“transactional”术语应从主叙事移除。

上述组件仍都有近邻，query-conditioned pruning 与 learned selector 本身也已被 DeferMem、LazyMem、Nano-Memory、MESA 和 learned retrieval/controller 工作覆盖。PiMem 目前唯一可能形成一般化新知识的，不是再增加一个 selector 模块，而是一项**受控系统诊断**：在相同 substrate 与预算下，candidate visibility、query-conditioned evidence selection、physical view 与 answer synthesis 如何共同决定长期记忆 QA。要成立，必须先在第二数据集复现“可见但未利用且 blanket auto-read 无效”的现象，再用预注册、budget-matched 对照隔离 selector 或 physical-view 因素，并经多次运行形成 QA/成本 frontier。当前 247 vs 239 和 34 vs 35 都只能写“open diagnostic question”，不能写“novel planner”“novel selector”或“established improvement”。

## 6. Claim--evidence ledger

| 拟写 claim | 当前证据 | 状态 |
| --- | --- | --- |
| production 当前为 candidate→read→auto-commit E0，并由 harness 生成 exact refs/provenance | 当前代码、schema 与测试；finish 不再接受 evidence refs | **supported as implementation** |
| PiMem 已实现 hidden reservoir、bounded page 与 continuation | 当前代码与测试 | **supported as implementation** |
| PiMem 的窄日期 route 不添加 gold term | 代码；smoker 单题 counterfactual | **supported but narrowly scoped** |
| 已知 20 个 recall failures 在 corpus-first substrate 中仍可达 | 19/20 宽池 union；剩余 1/20 由不加 gold term 的日期 route 找到 | **supported composite offline diagnostic; not one deployable arm** |
| 缩窄 answer-visible evidence 会恢复部分已知错误 | 13 题 summary-off B/C：current exact evidence 5/13，gold-only 9/13；paired 净 +4 | **supported oracle diagnostic; single sample and gold-conditioned** |
| V1 bundle 在定向冻结集上优于旧 baseline | paired-84：40/84 → 52/84；15 gains、3 losses，净 +12 | **supported targeted paired evidence; single run, enriched slice** |
| coverage Skill 改动改善 V1 | matched paired-84：V1 52/84，V2 49/84；3 gains、6 losses | **not supported in this run; do not generalize harm** |
| directory + production E0 稳定改善系统 | fresh online E0 247 vs matched inline 239，25/17 flips、`p=0.279956`；单次且成本更高 | **suggestive aggregate signal; not statistically or repeatedly established** |
| directory 被 Agent 使用并在部分题上连接 gold→correct | paired-84 至少 3 例；clean raw artifact 中 21 例 gold-read-commit、其中 15 例正确，20 个新版本-only correct 中有 3 例完整链 | **trace-supported mechanism occurrence; not average causal benefit** |
| V3 保持 guard 并改善 failure targets | guards 37/40 不变；failure targets 15/44 → 20/44；temporal 净 +5、multi-session 净 0 | **supported on the enriched paired slice only** |
| directory/E0 版本的检索成本没有增加 | fresh E0 相对 inline：candidates 94.17 vs 26.91、retrieval tokens 32,706 vs 23,645、search 1.73 vs 1.45 | **contradicted on measured retrieval resources** |
| clean directory+E1 为 235/300 | raw judge artifact 确为 235，但两题 method timeout 被重采样；严格计 0 后 234/300 | **raw artifact fact only; 234/300 is the reportable result** |
| E1 explicit commit 提高固定 trace 准确率 | fixed-trace fresh：E0 176/227、E1 169/227；E0-only 14、E1-only 7、`p=0.1892` | **not supported; observed direction is negative** |
| E1 显著压缩 answer prompt | 227 题 UTF-8 bytes 2,082,900 → 407,197（-80.5%） | **supported as byte compression only; token/cost/latency TBD** |
| production E0 的 clean online full-300 准确率 | strict 247/300；1 method timeout 直接计 0、无 retry | **supported as one complete run** |
| production E0 显著优于 matched inline | 247 vs 239，+2.67 pp，25/17 flips、`p=0.279956` | **not established; positive single-run direction only** |
| E0 最大的可定位漏斗是 candidate 可见但未 read | no-gold/partial 0/6 vs inline 8/25；candidate-all-not-read 58 vs 36 | **supported as a stagewise observation, not a sufficient causal explanation** |
| blanket top-4 unread-parent auto-inspect 能修复该漏斗 | 完整 58 题 34→35、3/4 flips、`p=1`；原始错误 22 题 2→2、2/2 flips、`p=1`；guard 38→39、1/2 flips、`p=1` | **not supported; do not merge to production** |
| blanket top-4 没有额外 answer 成本 | prompt tokens +49.5%、answer-call total tokens +44.7%、mean answer latency +4.9% | **contradicted in the fixed-trace A/B** |
| 历史系统在 paired-84 上达到 65/84 | 相同 ID 的历史 judge labels；但系统配方、预算与日期不匹配 | **supported as historical reference only** |
| 历史系统在 full-300 达到 255/300 | frozen historical answers；300/300 完整 datetime、176/300 calendar date 不匹配，成本不可比 | **supported as non-matched accuracy reference only** |
| V1/V2/V3 已取得正式 251/300、248/300 或 256/300 | 216 个 seeded baseline rows + 84 个 fresh rows 的 mixed artifacts | **unsupported as full-300 result; remove** |
| semantic-only physical planner 提高端到端准确率 | 尚无受控运行 | **TBD** |
| metadata pushdown 提高 temporal 子集 | 只有 1 个严格 case | **TBD** |
| evaluation-integrity 修复构成方法贡献 | method timeout final-zero/resume 规则和测试 | **engineering hygiene; explicitly not a method claim** |
| physical planner 优于 ReFind/A-RAG-style control | 尚无 matched baseline | **TBD** |
| 结果跨 dataset、controller 和 backend 泛化 | 尚无冻结实验 | **TBD** |
| PiMem 是新 retrieval algorithm 或 learned planner | 无对应方法 | **unsupported; remove** |

### 6.1 当前可以写进论文的 claim

1. clean directory+E1 的 raw judge artifact 为 235/300；两题 retrieval method timeout 严格计 0 后应报告 234/300（78.0%），低于 inline 239/300。原始 20/24 flips 与 `p=0.6516` 必须明确标注为修正前 artifact。
2. clean raw artifact 中，目录在 300 题全部曝光、92 题被直接读取、49 题被提交；21 题形成 directory-gold→read→commit，15 题最终正确。这个 trace 证明机制被使用，不证明它提高总体分数。
3. clean stage transition 显示 48 题从 inline gold-committed-correct 进入新版本 candidate-not-committed，产生 15 个净损；这与 fixed-trace E0/E1 的负方向共同指向 evidence omission 风险。
4. fixed-trace fresh E0/E1 为 176/227 vs 169/227，14/7 flips、`p=0.1892`；E1 prompt UTF-8 bytes -80.5%。可以写 accuracy--compression trade-off 和 production 回退，不可以写 E1 胜出。
5. fresh online production E0 strict 为 247/300；唯一 method timeout 直接计 0、无 retry。相对 matched inline 为 222/25/17/36，净 +8、`p=0.279956`；必须同时披露单次、未显著和成本上升。
6. E0 的题型结果为 multi 61/75、temporal 65/75、KU 40/45、assistant 29/30、user 41/45、preference 11/30；其中相对 inline 有 +6/+3/-1/-1/+3/-2，不能只挑正向类别。
7. E0 把 no-gold/partial 从 inline 8/25 降到 0/6，但 candidate-all-not-read 从 36 增到 58；可以写“可见但未 read 是最大的可定位漏斗”，不能把它直接写成原因或写成 recall/selection 已解决。
8. fixed-trace read-burden A/B 在完整 58 题上为 34/58 vs 35/58，在原始错误 22 题上为 2/22 vs 2/22，在 guard 上为 38/40 vs 39/40；三组 `p=1`。可以写 blanket top-4 无可靠收益、不能合 production。
9. 上述 B 相对 A 的 answer prompt tokens +49.5%、answer-call total tokens +44.7%、mean answer latency +4.9%；这是 fixed-trace answer 侧成本，不是 full-system 成本。
10. E0 平均 candidates 94.17、retrieval tokens 32,706、search 1.73，高于 inline 的 26.91、23,645、1.45；raw latency 较低但不是因果效率证据。
11. 在预先冻结的 44 个旧错题 + 40 个 guards 切片上，V1 相对旧 baseline 净改善 12 题；必须同时披露 15 gains、3 losses、单次运行和 selection enrichment。
12. V2 coverage Skill 的 matched 切片从 52/84 降到 49/84；V3 从 52/84 到 57/84，但 `p=0.3018`、收益集中 temporal、retrieval-agent tokens +34%。
13. 对 20 个已知 recall failures 的事后诊断显示 composite oracle 可达 20/20；13 题 gold-conditioned B/C 为 5/13 vs 9/13。两者都只能作为 failure diagnosis。
14. production 已实现 E0 exact-source ledger、stable refs、hash 与 runtime provenance。这是可审计系统性质，不自动构成新方法。

### 6.2 当前不能写进论文的 claim

1. “当前 PiMem 是 235/300”：原始 artifact 忽略了两题 method failure 的严格计分；正式口径是 234/300。也不能把当前 production E0 写成 234，因为 234 来自 directory+E1。
2. “当前 PiMem 为 251/300、248/300 或 256/300”：这些数来自 216 个旧 seed 行与 84 个新行的 mixed aggregate。
3. “V1 在完整 LME-S300 提升 12 题”或“V3 paired-84 +5 等于 full-300 +8”：定向切片与 fresh E0 full-300 是不同实验单位。
4. “explicit commit 改善准确率”或“E1 与 E0 等价”：169<176、14/7 flips，且当前实验不是等价性设计。
5. “E1 节省 80.5% tokens/成本”：已测的是 prompt UTF-8 bytes，不是 tokenizer tokens、价格或端到端 latency。
6. “directory/physical planner 已稳定提高总体准确率”：E0 bundle 只有一次 +8、`p=0.279956`，而且没有隔离 directory、metadata route 与 Agent-facing control。
7. “inspect/commit、reservoir、去 summary 或 metadata route 单独导致 V1 +12”：V1 是 bundle，没有组件级反事实。
8. “oracle 已解决 20/20 recall”或“gold-only selector 可部署”：20/20 是两个离线 arm 的并集，C 直接使用 benchmark gold。
9. “coverage Skill 有效”或“普遍有害”：当前只有一次 49<52 matched 观测。
10. “历史 65/84 或 255/300 是 matched baseline”：系统配方、预算和 question dates 不匹配。
11. “semantic-only physical planner 已成立”：当前 search 仍暴露物理控制，production E0 的 P0/P1/P2 受控实验尚未完成。
12. “timeout 修复是论文方法创新”：它只能进入 Evaluation Protocol / Integrity 或 artifact contribution。
13. “E0 raw latency 更低所以方法更快”：provider 与并发条件不同，且 E0 用了更多 candidates、tokens 和 search calls。
14. “top-K candidate auto-handoff 是新方法”或“应合入 production”：已完成 fixed-trace 诊断只得到 34/58→35/58、原始错误 2/22→2/22，且 prompt tokens +49.5%。
15. “candidate-all-not-read 证明答案只差四条 evidence”：该 stage 是 gold-conditioned 可观察漏斗；blanket top-4 负结果说明 query-conditioned selection、证据噪声与 answer synthesis 尚未区分。

## 7. 最低强基线

### 7.1 必须有的直接 baseline

1. **Single-shot BM25/hybrid**：提供非 agentic 下界，并校验改进是否只是更深 top-k。
2. **ReFind matched reproduction**：复用其 published prompt、search budget、top-k、context expansion 和 reasoning separation；这是同 benchmark 上最危险的直接 baseline。
3. **A-RAG-style Agent control**：Agent 直接选择 keyword/semantic/chunk read，检验低层工具自主性。
4. **Semantic query + fixed hybrid**：去掉 planner 自适应，隔离“接口收缩”与“物理规划”的效果。

若资源允许，应加入 Nano-Memory/QDP、DeferMem 或 LazyMem 中至少一个公开可复现的 query-time evidence narrowing baseline。Mem0、GraphRAG、LightRAG 和 Letta 可以作为不同 memory substrate 的参照，但不能替代 ReFind/A-RAG-style 直接对照。

### 7.2 公平性硬约束

- controller 与 answer model 一致；
- memory scope、ingestion、question date、judge prompt 和 decoding 一致；
- semantic search call、总 retrieval operation、最大候选计算量和 Agent-visible tokens 分别报告；
- baseline 不因实现方便而得到更少的搜索预算或更差的 prompt；
- 所有 operator catalog、planner rule 和 prompt 在 test 前冻结并记录 hash；
- 不用已知 failure 20、44 或 gold source 调任何在线阈值。

## 8. 已完成的 read-burden 诊断与条件性剩余实验

### 8.1 原 `3 × 2` 计划已被新证据取代

原计划把 physical-control P 与 evidence-boundary E 做 `3 × 2`。现在 E0/E1 已在 227 个 fixed traces 上得到直接 fresh answer 对照：

| Evidence boundary | Correct | Accuracy | Paired relative to E0 | Prompt UTF-8 bytes |
| --- | ---: | ---: | --- | ---: |
| E0 all inspected / auto-commit | **176/227** | 77.53% | reference | 2,082,900 |
| E1 explicit commit | **169/227** | 74.45% | E0-only 14、E1-only 7、`p=0.1892` | 407,197（-80.5%） |

这不是完整 online factorial，但已足以否定“先把 E1 当作创新候选，再烧六个 full-scale arms”的资源分配。production 已回退 E0；除非未来论文明确研究 accuracy--compression frontier，否则 E1 只保留为负结果，不进入主方法矩阵。若跨数据集前置门槛通过并最终进入 P matrix，所有 P arms 应固定为 E0、no-summary exact handoff。

### 8.2 已完成：fixed-trace top-4 candidate auto-handoff（仅诊断）

**实验动机。** fresh E0 的 58 题落在 `candidate_all_not_read`，明显高于 inline 的 36；需要判断这些“已可见但未 read”的候选若直接进入 answer evidence，是否能恢复错误，而不是立即再改在线 planner。

**论证逻辑。** 从 fresh E0 冻结 trace 中取完整的 58 题 `candidate_all_not_read` stage（原 judge 36 对/22 错，没有 wrong-only filter）与 40 题 `all_gold_read_answer_correct` guard。Gold 用于 eligibility/诊断分层，因此该实验是 gold-conditioned diagnostic；但 B 始终按首次成功 search 的 full-page display order 取前 4 个未读 parent，evidence 选择本身不使用 gold。A 是 current exact-read prompt，B 为 A 加上述 4 个 parent 并通过 production projector 生成 exact evidence；两臂 fresh answer 和 official judge 均无成功输出 retry。

**实验效果。** 完整 58 题为 A 34/58、B 35/58，A-only/B-only 3/4、`p=1`；其中原始错误 22 题为 2/22、2/22，2/2 flips、`p=1`；40 个 guard 为 38/40、39/40，1/2 flips、`p=1`。B 的 answer prompt tokens +49.5%、answer-call total tokens +44.7%、mean answer latency +4.9%。该诊断不是 full-300，也不支持 online planner improvement；它只足以关闭 blanket auto-inspect 路线。不能合 production，也不要通过增加 K 或继续堆候选追分。

### 8.3 条件性 Factor P：物理控制位置

下面矩阵不再是紧接着 LME-S300 开跑的默认计划。只有在第二数据集预注册复现“候选可见但 blanket auto-read 无效”，并冻结一个不使用 gold、预算匹配的 query-conditioned selector 或更干净 physical view 后，才值得运行。若选择 learned selector/learnware 路线，它必须另设 matched learned-selection baseline；generic learned routing 已有充分先例，不能把“使用学习器”本身称为创新。

| Arm | Agent 可表达内容 | harness 行为 | 要隔离的问题 |
| --- | --- | --- | --- |
| P0 Agent-facing physical control | query + keyword/semantic/operator/filter/depth 等低层动作 | 忠实执行 | 在 PiMem 相同组件与预算内隔离高控制接口 |
| P1 Semantic-only + fixed retrieval | 仅自然语言 information need | 固定 hybrid、固定深度、无 query-adaptive metadata/planning | 仅收缩接口是否已足够 |
| P2 Semantic-only + physical planner | 仅自然语言 information need | 宽 hybrid reservoir、经过验证的 metadata route、bounded visible page/continuation | 后台物理规划是否带来额外收益 |

P0 是同组件、同预算的内部 control，不等于 ReFind reproduction，也不等于 A-RAG 实现。第 7 节的 matched ReFind 与 A-RAG-style baseline 必须作为两个独立外部对照分别运行和报告。

P2 不能通过 gold、题型名称或 benchmark-specific Skill 选择规则。若 planner 只是固定 reservoir + 单日期规则，论文必须如实称 deterministic planner，不得称 learned 或 adaptive controller。

### 8.4 条件性主结果表保持 TBD

| Physical control，全部固定 E0 | Clean online full-300 QA | Visible gold | Read gold | Retrieval tokens / latency |
| --- | ---: | ---: | ---: | ---: |
| P0 Agent-facing physical control | TBD | TBD | TBD | TBD |
| P1 Semantic-only fixed retrieval | TBD | TBD | TBD | TBD |
| P2 Semantic-only physical planner | TBD | TBD | TBD | TBD |

现有证据不能提前填入任何一格。fresh online E0 247/300 是当前混合控制接口下的 **unfactorized reference**：search schema 仍允许 Agent 操作 operator、branch、combine 和 filter，因此既不是 semantic-only P1，也不是 P2；它也没有提供同预算 P0 对照。E1 clean 234、fixed-trace E0/E1 与已完成但为负的 top-4 auto-handoff diagnostic 同样不能填入 P 表。只有先跨数据集确认研究现象、再另行冻结接口与预算的 P0/P1/P2 online runs，才能估计 physical-control effect。

必须预注册并报告 `P2-P1` 与 `P2-P0`，而不是只挑最好的一格。关键可证伪假设是：

- H1：P2 在相同候选计算、检索调用和 Agent-visible token 预算下，提高 visible gold coverage；
- H2：visible coverage 的提升能继续转化为 read gold 与最终 QA，而不只停在 hidden pool/directory；
- H3：P2 的 QA/成本 frontier 优于 P0/P1，并在未见数据与多次运行中保持；
- H4：所有 exact source 都满足 lineage invariant；该性质本身不够构成方法贡献。

若 P2 只扩大候选、tokens 或 latency，却不提高 QA；或其收益只来自更多预算，则 physical planner 也应从方法 claim 中删除。此时保留的论文价值只能是 stagewise failure funnel 和负结果。

## 9. 跨数据集、多次运行与统计门槛

### 9.1 数据边界

- 当前 MemoryAgentBench LME-S300 可继续作为开发与回归集，但已知 20/44 道错误不能作为最终 held-out 证明；
- 至少增加完整、冻结且清洗版本的 LongMemEval-S500，或预先固定的未见 test split；
- 至少增加一种不同 memory shape：LoCoMo、MemoryAgentBench 其他能力，或 [LongMemEval-V2 官方仓库](https://github.com/xiaowu0162/LongMemEval-V2) 中的长轨迹任务；
- 若声称 backend portability，至少在 BM25-only 与 dense/hybrid 两种 backend 上复现；否则删除 portability claim。

### 9.2 controller 与重复运行

- 至少两个 controller 强度，例如一个小模型和 GPT-5-mini 级模型；LogicalRAG 已显示高控制接口对模型能力敏感，因此单 backbone 不足以支持 control-locus 结论；
- 每个含随机 LLM 决策的主 arm 至少 3 次独立运行；优先 5 次报告均值、标准差和逐题稳定性；
- judge 固定版本、temperature 和 prompt；抽样做人审以估计 judge noise；
- 用 paired bootstrap confidence interval 与 paired McNemar 检验逐题准确率差，不只报告百分点。

### 9.3 必报指标

1. 最终 QA：总体及 information extraction、multi-session、temporal、knowledge update、preference、abstention 分层；
2. stagewise funnel：hidden-pool recall、visible@K recall、inspected recall、committed recall/precision/F1；
3. evidence quality：充分性、最小性、冲突来源数、exact attribution 和 invalid-ref rate；
4. cost：controller/answer input tokens、search calls、retrieval operations、候选计算量、P50/P95 latency；
5. reliability：method failure 与 infrastructure failure 分开报告，另列 timeout、retry、protocol rejection、未完成率和 strict-zero 数；
6. trace integrity：source commit、harness fingerprint、operator catalog hash 和 judge manifest。

### 9.4 下一步最小实验门槛

先按以下 gates 迭代，避免继续在已经不支持的 explicit-commit 方向消耗资源：

1. **记录完成的 strict E0 reference。** fresh online E0 为 247/300；1 method timeout 直接计 0、无 retry。相对 inline 单次 +8 但 `p=0.279956`，不能作为已越过论文门槛的结果。后续每次运行继续使用 method-failure final-zero 语义。
2. **停止把 E1 当 promotion 方向。** fixed-trace 169<176 已给出方向为负的直接证据。除非研究目标改为压缩 frontier，否则不再为 E1 跑 `3 × 2` 或调 selected-evidence prompt；若保留，必须同时报告 -80.5% bytes 与 -3.08 pp 的观测方向。
3. **关闭 blanket top-4 auto-inspect。** 已完成诊断在 58 题上为 34→35、原始错误 22 题为 2→2，三组主/guard 检验均 `p=1`；prompt tokens +49.5%。该路线不合 production，不再通过增加 K、扩大 reservoir 或自动塞更多候选调 LME-S300。
4. **先做跨数据集现象复现。** 在冻结的第二数据集/held-out split 上，预注册 stage taxonomy 与 sampling，检验 candidate-visible-not-used 是否仍是主要漏斗、gold-free blanket auto-read 是否仍无效。若现象不复现，停止通用研究叙事，只保留 LME-S300 诊断报告。
5. **只定义 query-conditioned 干预。** 若现象复现，在开发集冻结 query-conditioned selector/learnware 或更干净 physical view；不得使用 gold、题型标签或当前 58/22 IDs 调规则。报告 sufficient-evidence、噪声、answer synthesis、tokens 与 latency，避免只优化 visible recall。
6. **再决定是否运行 P 因素。** 只有上述干预可被明确归入 physical-control locus 时，才在 E0 下运行 budget-matched P0/P1/P2，并预注册 `P2-P1`、`P2-P0`、QA、visible/read gold、tokens 和 latency。P0 仅是内部 control；matched ReFind 与 A-RAG-style 仍是独立外部基线。
7. **复验 aggregate。** 若仍要写性能 claim，至少再做 2 次独立 E0/候选主臂 full run，使每个随机主 arm 总计至少 3 次，报告均值、方差、逐题稳定性、paired CI 与 McNemar；正向不稳定或成本净值为负时停止性能叙事。
8. **论文外推。** 方法 claim 必须同时有第二数据集、matched ReFind/A-RAG-style、至少 3 次运行及逐题置信区间。若做不到，只写定向回归、诊断或系统性质，不写通用方法收益。

历史 65/84 与 255/300 都必须另列为 non-matched engineering reference；它们不能替代 fresh matched arm，也不能成为挑选配置的 oracle。

### 9.5 最低可发表门槛

只有同时满足以下条件，才建议按方法或主系统贡献投稿：

- 相对 matched ReFind/A-RAG-style baseline 有非平凡因果收益，而非只优于弱 single-shot baseline；
- 若声称 physical control locus 是贡献，P2 必须在 E0 下优于 P1 与 P0，并且在两个数据集和多个随机运行中保持；只提高 visible recall 而不提高 QA/成本 frontier，不足以称方法贡献；
- 增益不能由更多检索计算、更多 Agent-visible token、不同 question date 或 retry-until-success 解释；
- temporal 增益来自一组 held-out temporal questions，而不是单一 smoker case；
- 所有主要 claim 都有对应消融，失败类别和负结果也完整报告。

如果只有已知 20 道错题的离线恢复、15 个 directory-linked correct traces、80.5% prompt-byte compression，或只在当前 LME-S300 上调参后上涨，都不足以证明方法创新。top-4 read-burden 的 34→35 且成本上升进一步说明，不应继续用同一 benchmark 上的 candidate/auto-read 调参替代跨数据集验证。

当前 fresh E0 的 247/300 也尚未越过该门槛：它相对 inline 只有一次 +8、`p=0.279956`，而候选约 3.50×、retrieval tokens +38.3%、search calls +19.5%。除非重复运行、budget-matched P controls 和强外部基线表明 QA/成本 frontier 仍占优，否则它只能支撑系统诊断，不支撑方法 superiority。

## 10. 论文叙事决策树

### 10.1 若准确率与证据效率均稳定提升

只有 production E0 下的 P2 在受控实验中稳定胜出，才可定位为 physical-control / candidate-visibility system study，而不是新 retriever：

> **Who Should Plan Memory Retrieval? A Controlled Study of Semantic Intent and Candidate Visibility**

贡献顺序应是：

1. 一个关于物理控制位置的 matched empirical finding；
2. 一个 hidden-pool→visible→read→answer 转化的 stagewise finding；
3. 一个 training-free、exact-source、runtime-enforced 的系统实例及跨 backend 证据。

措辞应使用 “we study”“we instantiate”“we find”，避免 “the first”“novel retrieval algorithm”。

### 10.2 若准确率持平，但 evidence precision、token 或可靠性显著改善

可转为系统测量论文或 artifact，但不能再把 E1 称为准确率方法：

> **From Candidate Visibility to Evidence Use: Auditing Memory-Agent Retrieval Pipelines**

核心贡献只能是可复现实验协议、stage schema、lineage invariant、成本--准确率 frontier 和跨 backend conformance。E1 当前只证明 prompt bytes -80.5%，没有证明 token/latency 节省，且准确率方向为负；因此若采用 efficiency 叙事，必须补 tokenizer tokens、端到端 latency、价格与多次运行，不能只引用 byte compression。method-timeout 完整性修复可作为 artifact 可靠性细节，但不是核心方法创新。

fresh E0 当前也不满足 efficiency 叙事：虽然 raw latency 较低，但 candidates 约 3.50×、retrieval tokens +38.3%、search calls +19.5%，而 latency 受 provider/concurrency 混杂。除非后续 budget-matched 实验形成更优 frontier，不能把 247/300 与较低 latency 拼成“更准且更快”。

### 10.3 若性能没有稳定提升

应转为诊断/负结果论文：

> **Found but Not Used: A Stagewise Audit of Long-Term Memory Agents**

可贡献：

- candidate→visible→inspect→commit→answer 的 failure funnel；
- 20 道 recall failure 与 13 道 gold-committed failure 的人工归因；
- 深池可达性不等于可见、可读或最终可用 evidence；
- V1 paired-84 的 15 gains/3 losses、V2 coverage Skill 的 3 gains/6 losses、V3 directory 的 10 gains/5 losses，以及 E1 strict 234、E0 strict 247、inline 239 之间揭示的 evidence-boundary 敏感性；
- clean stage transitions、目录的 300→92→49 和 gold 50→26→21→15 链，以及 retrieval tokens +27.7%、mean latency +40.1% 的收益--成本张力；
- fixed-trace E0/E1 的 176 vs 169、14/7 flips、`p=0.1892` 和 prompt bytes -80.5%，作为“更窄 evidence 不必然更准”的受控负结果；
- fresh E0 的 247 vs 239、25/17 flips、`p=0.279956`，以及 no-gold/partial 0/6、candidate-all-not-read 58 所揭示的“召回已改善但利用未解决”；
- fixed-trace read-burden 的 34/58 vs 35/58、原始错误 2/22 vs 2/22、guard 38/40 vs 39/40（三组 `p=1`），以及 prompt tokens +49.5%，作为“可见但未 read 不等于只差四条候选”的受控负结果；
- E0 candidates 94.17、retrieval tokens 32,706、search 1.73 相对 inline 26.91、23,645、1.45 的资源代价；
- 对“更多 Agent-facing 工具一定更好”“检索命中即能回答”或“blanket auto-read 能修复 evidence utilization”的受控负结果。

当前证据已经更接近这一分支。此时必须把范围限定为当前模型、预算和 benchmark，不得把 production 回退、timeout 计分修复或系统重构包装成算法创新。若 stage taxonomy 与负结果不能在第二数据集复现，最诚实的产出是工程报告，而不是强行投稿方法论文。

## 11. 推荐论文结构

1. **Introduction**：提出“谁控制物理检索、深层 candidate 如何转化为实际 evidence”两个问题，而不是宣称已有新方法。
2. **Problem Formulation**：定义 semantic intent、physical result、hidden pool、visible page、read set、E0 answer set 和 lineage invariant。
3. **Empirical Diagnosis**：报告 inline 239/300、clean E1 raw 235/strict 234、fresh E0 strict 247、历史 255 non-matched、stage/cost/directory chain、20/20 composite oracle、13 题 B/C、fixed-trace read-burden 负结果以及 V1/V2/V3 paired-84；E0 的 `p=0.279956` 和成本、top-4 的三组 `p=1` 与 +49.5% prompt tokens 必须和对应结果同表出现。
4. **System Instantiation**：描述 deterministic reservoir、compact directory、窄 metadata route、stable refs 和当前 E0 auto-commit；不称 learned planner 或 explicit-commit method。
5. **Controlled Evaluation**：报告 completed fixed-trace E0/E1 与 top-4 read-burden 两个负结果；P0/P1/P2 只在第二数据集复现现象并冻结 query-conditioned 干预后，才成为条件性主表。
6. **Related Work**：最先比较 ReFind、A-RAG、LogicalRAG、DeferMem/LazyMem/Nano-Memory 与 MemTX；Mem0/GraphRAG 放在 substrate 段落。
7. **Limitations / Negative Results**：报告 E1 的两次历史 timeout 修正、E0 的一次 strict-zero timeout、单日期规则、read-burden 的 gold-conditioned eligibility、judge noise、单次 E0、模型依赖和 retrieval/answer 成本。

## 12. 审稿人式自检

| 维度 | 当前判断 | 解除风险所需证据 |
| --- | --- | --- |
| Contribution | **currently unsupported as a method** | 复验 E0 单次 +8，并证明 P2 相对 P0/P1 产生跨数据集、budget-matched 新知识 |
| Writing clarity | **pass with constraints** | 始终区分 paired-84、mixed artifacts、E1 raw 235/strict 234、E0 strict 247、inline 239 与 non-matched historical 255 |
| Experimental strength | **fixed-trace diagnostics complete; general claim still weak** | 第二数据集现象复现、query-conditioned 对照、E0 多次运行、条件性 P0/P1/P2、matched ReFind/A-RAG-style |
| Evaluation completeness | **integrity fixed; generalization incomplete** | method failure strict-zero 已修；仍需第二数据集、第二 controller、完整 token/latency |
| Method soundness | **explicit commit 与 blanket auto-read 均不支持；E0 costly** | E1 已回退、top-4 不合 production；若继续只验证 query-conditioned selection/clean physical view、planner budget 与跨 dataset/backend 稳健性 |

在上述风险被解除前，Abstract 和 Introduction 不应出现“显著优于”“通用”“首次”或“SOTA”。

## 13. 一手来源

- ReFind: [When Your Agent Opens the Chat App](https://arxiv.org/html/2608.12888)
- A-RAG: [paper](https://arxiv.org/abs/2602.03442), [official repository](https://github.com/Ayanami0730/arag)
- LogicalRAG: [Rethinking Agentic RAG](https://arxiv.org/html/2605.27123)
- Nano-Memory: [paper](https://arxiv.org/html/2604.11628), [official repository](https://github.com/yuqian2003/Nano-Memory)
- DeferMem: [paper](https://arxiv.org/html/2605.22411)
- LazyMem: [paper](https://arxiv.org/html/2607.22690), [official repository](https://github.com/allacnobug/LazyMem)
- MESA: [Task-Adaptive Multi-Structure Evidence Selection](https://arxiv.org/html/2608.10108)
- MemTX: [Transactional Belief Commit for Stateful Agent Memory](https://arxiv.org/html/2607.23929)
- LongMemEval: [paper](https://arxiv.org/html/2410.10813), [official repository](https://github.com/xiaowu0162/LongMemEval)
- MemoryAgentBench: [paper](https://arxiv.org/abs/2507.05257)
- MemGPT/Letta: [MemGPT paper](https://arxiv.org/abs/2310.08560), [Letta official repository](https://github.com/letta-ai/letta)
- Mem0: [paper](https://arxiv.org/abs/2504.19413), [official repository](https://github.com/mem0ai/mem0)
- GraphRAG: [paper](https://arxiv.org/abs/2404.16130), [official repository](https://github.com/microsoft/graphrag)
- LightRAG: [paper](https://arxiv.org/html/2410.05779), [official repository](https://github.com/HKUDS/LightRAG)
- Adaptive-RAG: [paper](https://arxiv.org/abs/2403.14403)
- Search-R1: [paper](https://arxiv.org/abs/2503.09516)
- PaperQA2: [paper](https://arxiv.org/abs/2409.13740), [official repository](https://github.com/Future-House/paper-qa)

## 14. 内部证据位置

- 深入消融：`docs/research/pimem-lme-s300-deep-ablation-20260830-zh.md`
- clean audit：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-ablation-20260830/inline-compose-v2-wrap-audits.clean.jsonl`
- recall ablation：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-ablation-20260830/oracle-retrieval-ablation.nonpref-wrong20.v3.json`
- metadata counterfactual：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-ablation-20260830/smoker-date-window-counterfactual.json`
- evidence re-answer：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-evidence-reanswer-20260830/summary.json`
- paired-84 manifest：`/data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830/artifacts/regression-84-manifest.json`
- V1 official judge mixed artifact：`/data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830/evaluation/gpt4o-official-guard84/longmemeval-s-static.json`（只在 manifest 84 IDs 上作 paired 分析）
- V2 official judge mixed artifact：`/data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830/evaluation/gpt4o-official-skill-coverage-v2/longmemeval-s-static.json`（只在 manifest 84 IDs 上作 paired 分析）
- V1/V2 source pins：`/data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830/artifacts/source-evidence-transaction-reservoir-v1.SHA256SUMS`、`source-skill-coverage-v2.SHA256SUMS`
- V3 preparation/source delta：`/data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830/artifacts/directory-v3/PREPARATION_MANIFEST.json`
- V3 paired comparison：`/data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830/artifacts/directory-v3/comparison/controlled-regression-v3-comparison.json`
- V3 mechanism trace：`/data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830/artifacts/directory-v3/comparison/controlled-v3-directory-mechanism.json`
- V3 official judge mixed artifact：`/data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830/evaluation/gpt4o-official-guard84-directory-v3/longmemeval-s-static.json`（256/300 仅为 mixed bookkeeping；paired 分析只取 84 IDs）
- paired-84 设计说明：`/data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830/artifacts/GUARD84.md`
- mixed aggregate 禁用口径：`/data/zhaogangyi/pi-mem-eval/lme300-controlled-regression-20260830/artifacts/RUNBOOK.md`
- historical 255/300 judge：`/data/zhaogangyi/pi-mem-eval/refind-protocol-20260824/full-native-observation-v5-lme-s500-budget4-composite-s128-run1/evaluation/current-gpt4o-mab300-rejudge/output/longmemeval-s-static.json`（同 84 IDs 回看为 65/84）
- clean full-300 run：`/data/zhaogangyi/pi-mem-eval/lme300-current-final-20260831/runs/current-final-full300-run1/longmemeval-s-static.json`
- clean raw judge artifact：`/data/zhaogangyi/pi-mem-eval/lme300-current-final-20260831/evaluation/gpt4o-official/longmemeval-s-static.json`（raw 235/300；严格 method-failure 口径为 234/300）
- clean full-300 manifest 与 method-timeout audit：`/data/zhaogangyi/pi-mem-eval/lme300-current-final-20260831/FINAL_MANIFEST.json`、`/data/zhaogangyi/pi-mem-eval/lme300-current-final-20260831/runtime/memory-service/operation-audits.jsonl`
- clean stage/cost/directory comparison：`/data/zhaogangyi/pi-mem-eval/lme300-current-final-20260831/analysis/clean-full300/clean-full300-comparison.json`、`clean-full300-comparison.md`（paired flip/`p` 均对应 strict 修正前 raw 235 artifact）
- fixed-trace E0/E1 summary：`/data/zhaogangyi/pi-mem-eval/lme300-evidence-commit-ablation-20260831/summary.json`
- fixed-trace E0/E1 selection、prompt-byte 与 gold-free eligibility：`/data/zhaogangyi/pi-mem-eval/lme300-evidence-commit-ablation-20260831/preparation/eligibility-and-prompts.json`
- fixed-trace E0/E1 final manifest：`/data/zhaogangyi/pi-mem-eval/lme300-evidence-commit-ablation-20260831/FINAL_MANIFEST.json`
- fresh online E0 final manifest：`/data/zhaogangyi/pi-mem-eval/lme300-e0-auto-handoff-formal-20260831/FINAL_MANIFEST.json`
- fresh online E0 run：`/data/zhaogangyi/pi-mem-eval/lme300-e0-auto-handoff-formal-20260831/runs/e0-auto-handoff-formal-full300-run1/longmemeval-s-static.json`
- fresh online E0 strict matched comparison：`/data/zhaogangyi/pi-mem-eval/lme300-e0-auto-handoff-formal-20260831/evaluation/strict-matched-comparison.json`
- fresh online E0 official judge：`/data/zhaogangyi/pi-mem-eval/lme300-e0-auto-handoff-formal-20260831/evaluation/gpt4o-official/longmemeval-s-static.json`
- fresh online E0 gold-stage mechanism diagnostic：`/data/zhaogangyi/pi-mem-eval/lme300-e0-auto-handoff-formal-20260831/audits/gold-stage-mechanism-diagnostic.json`
- fresh online E0 integrity audit：`/data/zhaogangyi/pi-mem-eval/lme300-e0-auto-handoff-formal-20260831/audits/formal-run-integrity-audit.json`
- fixed-trace candidate read-burden final manifest：`/data/zhaogangyi/pi-mem-eval/lme300-candidate-read-burden-ablation-prep-20260831/FINAL_MANIFEST.json`
- fixed-trace candidate read-burden paired summary：`/data/zhaogangyi/pi-mem-eval/lme300-candidate-read-burden-ablation-prep-20260831/analysis/paired-summary.json`
- fixed-trace candidate read-burden 中文报告：`/data/zhaogangyi/pi-mem-eval/lme300-candidate-read-burden-ablation-prep-20260831/analysis/report-zh.md`
- 独立召回报告：`integrations/memoryagentbench/research/oracle-retrieval-ablation-report-zh.md`
