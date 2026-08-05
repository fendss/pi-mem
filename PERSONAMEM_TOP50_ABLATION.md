# PersonaMem-v2-32K Raw Top-50 Ablation

## Contract

This Answer-only experiment reuses the sealed PersonaMem retrieval artifacts and the exact raw-memory projection used by the Top-30 baseline:

1. preserve retrieval order;
2. deduplicate by immutable memory ID;
3. select at most Top-K memories;
4. restore selected memories to chronological role-preserving conversation order;
5. call the fixed Answer model at temperature 0.

No Add, Search, Read, Finish, reranking, or Gold access occurs during request construction. Gold is loaded only by the post-Answer deterministic scorer.

Only 59/600 questions had more than 30 unique retrieved memories. The other 541 Top-50 requests were byte-identical to their Top-30 requests, so their previously persisted successful answers were reused. Exactly 59 new Answer calls were made.

## Result

| Variant | Correct | Accuracy | Mean memories | Mean context chars |
|---|---:|---:|---:|---:|
| Raw Top-30 | 267/600 | 44.50% | 13.99 | 10,011 |
| Raw Top-50 | 270/600 | 45.00% | 15.18 | 10,753 |

Paired transitions:

```text
Top-30 correct, Top-50 wrong: 3
Top-30 wrong, Top-50 correct: 6
same predicted letter:          586/600
net Top-50 gain:                3 questions / 0.50 points
McNemar exact p:                0.5078
```

Among the 59 changed questions:

```text
Top-30 correct:          26/59
Top-50 correct:          29/59
mean Top-30 memories:    30.00
mean Top-50 memories:    42.12
same predicted letter:   45/59
```

Category net correct-answer changes were `+1` anti-stereotypical, `+1` neutral, `+2` stereotypical, `-1` sensitive information, and zero for forgetting, medical, and therapy.

## Conclusion

Increasing the cap from 30 to 50 produces only a small, statistically insignificant gain. The limited effect is expected because 541/600 questions have no additional retrieved memories beyond Top-30. For the 59 affected questions, additional context has mixed effects: six errors are fixed while three correct answers regress.

Raw Top-50 is numerically the strongest non-Gold PersonaMem variant tested, but the evidence does not justify preferring it over Top-30 on accuracy alone. Top-30 remains the more efficient default; Top-50 is a reasonable opt-in ceiling experiment for scopes with more than 30 retrieved memories.
