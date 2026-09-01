# PiMem × MAB LongMemEval-S：召回错题离线机制消融

## 结论

这轮消融不支持“PiMem 当前的主要召回瓶颈是 Agent 无法把候选集继续组合成新算子”。

在 inline-compose-v2 最终答错、非 preference、且 gold source 未完整进入候选的 20 题中：

- 17 题仅重放 Agent 已经生成的查询并扩大普通 hybrid/lexical 深度即可完整覆盖 gold；
- 2 题的缺失证据存在于某个既有查询的 per-query top-100 中，但在 joint ranking 和 RRF top-40 中均被压掉；
- 最后 1 题中，Agent 已经正确生成日期 `2023-03-15`，把这个已有日期下推为记录时间范围后，原 hybrid 查询把 gold 排到第 4；
- same-session neighbor 和 anchor-content second retrieval 各最多完整恢复 3 题，而且这些题全部也能被普通 corpus-first replay 恢复；`candidate_dependent_only = 0/20`。

因此，当前 20 道召回型错题的主因是：**物理召回深度、候选融合和结构化元数据路由没有与模型可见窗口解耦**，而不是缺少一套 Agent-facing CandidateSet 编程接口。

## 数据与口径

- 方法版本：MemoryAgentBench LongMemEval-S `inline-compose-v2`。
- 原始结果：239/300。
- clean audit：只保留 2026-08-30 11:05–11:19 UTC 内、每题最终一次 wrap；300 题唯一对应。
- 主消融目标：`correct=false`、问题类型不是 `single-session-preference`、stage 为 `no_gold_candidate` 或 `partial_gold_candidates` 的 20 题。
- 题型：multi-session 8、temporal-reasoning 9、single-session-user 2、knowledge-update 1。
- 原轨迹平均 1.8 次成功语义 search；分布为 1 次 14 题、2 次 2 题、3 次 2 题、4 次 1 题、8 次 1 题。
- Gold 仅在运行结束后衡量候选覆盖。除明确标注的 oracle-rerank 外，没有 arm 使用 gold 文本、答案或 memory ID 构造查询。

`observed_search` 只计算 search/search_more 暴露的候选；`observed_retrieval` 还包括 read expansion，后者与 `diagnose_longmemeval_pipeline.py` 的 candidate 口径完全一致。

## 主要结果

| Arm | 完整覆盖题数 | 平均候选数 | 平均 session 数 |
|---|---:|---:|---:|
| observed search | 0/20 | 28.50 | 17.50 |
| observed retrieval（含 read expansion） | 0/20 | 33.35 | 17.50 |
| hybrid top-20 | 3/20 | 24.25 | 11.80 |
| hybrid top-40 | 12/20 | 47.90 | 22.40 |
| hybrid top-60 | 15/20 | 70.85 | 32.35 |
| hybrid top-80 | 17/20 | 92.70 | 40.75 |
| hybrid top-100 | 17/20 | 114.40 | 47.70 |
| lexical top-20 | 6/20 | 24.50 | 14.50 |
| lexical top-40 | 11/20 | 46.35 | 26.70 |
| lexical top-100 | 12/20 | 94.10 | 46.20 |
| hybrid per-query top-20 union | 14/20 | 70.55 | 33.65 |
| hybrid per-query top-20 → RRF top-20 | 2/20 | 20.00 | 10.20 |
| hybrid per-query top-20 → RRF top-40 | 11/20 | 39.10 | 19.75 |
| hybrid per-query top-100 union | 19/20 | 268.50 | 82.15 |
| hybrid per-query top-100 → RRF top-20 | 3/20 | 20.00 | 10.35 |
| hybrid per-query top-100 → RRF top-40 | 10/20 | 40.00 | 19.00 |
| max-per-session=1, hybrid top-20 | 4/20 | 24.95 | 23.55 |
| top-10 observed anchors ±2 turns | 3/20 | 52.45 | 17.50 |
| anchor-content second hybrid retrieval | 3/20 | 36.15 | 17.90 |

### 发现一：深度是第一主变量

Hybrid 从 top-20 到 top-40，完整覆盖由 3 题变成 12 题；到 top-80 后达到 17 题，top-100 不再增加。17 题的首次完整恢复位置为：

- hybrid top-20：3 题；
- lexical top-20：额外 4 题；
- hybrid top-40：额外 7 题；
- hybrid top-60：额外 1 题；
- hybrid top-80：额外 2 题。

这意味着 Agent 的查询在大部分错题上并没有失败。候选存在于同一查询结果的更深处，只是没有进入可见候选窗口。

### 发现二：更多 query path 不等于更好的可见排序

把每个既有查询独立执行 top-100，再直接 union，可覆盖 19/20；但候选池平均达到 268.5。把同一批结果 RRF 压缩到 top-20/top-40，只能完整覆盖 3/20 和 10/20，甚至不如普通 joint hybrid top-40 的 12/20。

两个典型长尾：

- `context-1/longmemeval_s*_no28`：问兄弟姐妹总数。一个 gold group 在 split top-100 union 中的首次位置为 156；RRF top-40 完全丢失它。
- `context-3/longmemeval_s*_no31`：问更换或修理过多少厨房物品。第 5 个 gold group 在 split top-100 union 中首次位于 143；RRF top-40 同样丢失。

Oracle rerank 能把这两题的 gold group 排到前 2/前 5，但这是使用 gold memory ID 的上界，只证明“宽池中存在证据且选择层有理论空间”，不能作为方法分数。

因此，直接扩大 observation 或机械增加 query union 会制造数百候选；普通 RRF 又无法可靠保住稀有证据。需要研究的是宽隐藏池到窄 evidence view 的语义选择，而不是让 Agent 自己管理这些候选 ID。

### 发现三：候选依赖的二跳检索没有独立贡献

- search 候选的 same-session ±2 turn expansion：完整覆盖 3/20；
- 取前 10 个 search 候选的原文作为新 query，再 hybrid 检索：完整覆盖 3/20；
- 两类方法没有恢复任何 corpus-first arms 无法恢复的题。

这不证明 CandidateSet dataflow 永远无用；它只说明不能用当前这 20 道错题作为重构 PiMem 工具协议的实验证据。

### 发现四：唯一完全缺失题是 metadata routing，而非新语义 query

`context-1/longmemeval_s*_no38` 问“10 天前购买了什么厨房电器”。Gold 记录为 2023-03-15 当天用户说刚得到一个 smoker。原 Agent 已生成：

- `purchase 2023-03-15`
- `bought on 2023-03-15`
- `2023/03/15`
- `2023-03-15`

这些既有 query 经 hybrid joint top-100、每 query top-100 union（253 候选）、lexical、neighbor 和 anchor-secondary 后仍完全没有 gold。

独立 counterfactual 只做一件事：从 Agent 既有 query 抽取 `2023-03-15`，作为记录的 `after/before` 当日窗口，同时原样保留既有 semantic queries 和 `roles=user`。结果：

- metadata date window + hybrid top-20：返回 11 个候选，gold rank=4；
- metadata date window + lexical top-20：返回 1 个候选，未命中 gold。

该 arm 不使用 gold 文本，也没有手写 smoker、BBQ 或 benchmark 规则。它只证明一般性的物理优化机会：**模型已经解析出的结构化约束没有被检索执行层消费。** 这不应被包装成新的 Agent-facing temporal operator。

## 对 PiMem 架构的直接含义

### 现在不应做

1. 不应基于这些错题把 `search/read/finish` 改成 CandidateSet 编程工具。
2. 不应继续在 Skill 中加入 multi-session、temporal、count 等题型策略。
3. 不应把 top-100 或 268 个 union candidates 直接写进 observation。
4. 不应把 oracle rerank 的 19/20 当成预计 benchmark 增益；模型仍可能选错或回答错。

### 下一步应做

保持 PiMem 的 Agent-facing 契约不变：

```text
search → read → finish
```

重构的是 `search` 内部，而不是增加工具：

```text
Agent semantic queries
  → physical retrieval planner
      - lexical 与 dense 独立宽召回
      - query-local 深池
      - 通用 metadata constraint pushdown
  → hidden candidate reservoir
  → question-conditioned selector / reranker
  → bounded visible candidates
  → read → evidence ledger
```

第一轮最小实现应只验证三项：

1. 物理召回深度与可见数量解耦，例如每 query 内部取 80/100，但只暴露 20；
2. 对宽池做 question-conditioned semantic rerank，和 RRF、max-score、现有 joint rank 在 held-out memory scope 上比较；
3. 只把 Agent 自己查询中显式、可验证的日期/role/session 约束下推给存储层，不增加 temporal 工具或 benchmark prompt。

如果一个不看 gold 的 selector 能在 held-out context 中把宽池证据稳定压入 top-20，才继续研究学习式 selector。若不能，就说明“宽池存在 gold”并不足以形成可部署收益。

## 论文叙事约束

当前证据不支持“自由合成候选算子解决跨 session/时序检索”。更符合实验的研究问题是：

> Agent 已经表达了足够的搜索意图时，memory harness 如何把它编译成高召回的物理执行计划，同时向模型暴露一个小而可靠的 evidence view？

PiMem 可以强调 evidence-first 的逻辑协议与物理检索执行解耦：Agent 负责表达语义需求和提交证据；harness 负责宽召回、元数据下推与有界候选选择。论文必须通过 held-out scope 和跨 benchmark 验证，而不是继续围绕这 20 题修改规则。

## 限制

- 本实验条件化在 20 道“最终答错且 gold 未完整进入候选”的题上，不代表全部 300 题的分数增益。
- Gold source 映射只用于事后覆盖评估；oracle-rerank 不可部署。
- per-query top-100 union 候选成本很高，只是可达性上界。
- anchor-dependent arms 只测试固定前 5/10 候选、同 session 邻居和直接以候选原文二次检索，没有穷举任意程序。
- 日期下推目前只有一个严格反例，只能作为设计诊断，不能声称已经解决 temporal reasoning。
- 所有 replay 均复用当前 Agent 生成的 query，因此没有衡量另一种 controller/query policy 的收益。

## 产物

- 主结果：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-ablation-20260830/oracle-retrieval-ablation.nonpref-wrong20.v3.json`
- 日期下推反例：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-ablation-20260830/smoker-date-window-counterfactual.json`
- clean audit：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-ablation-20260830/inline-compose-v2-wrap-audits.clean.jsonl`
- clean diagnostic：`/data/zhaogangyi/pi-mem-eval/memoryagentbench-lme-oracle-ablation-20260830/pipeline-diagnostic.inline-compose-v2.clean.json`
