#!/usr/bin/env python3
import unittest

from analyze_beam_official_results import (
    ANSWER_GENERATION_FOR_RAG,
    ANSWER_PROMPT_SHA256,
    JUDGE_PROMPT_SHA256,
    UNIFIED_LLM_JUDGE_BASE_PROMPT,
    evidence_groups,
    render_answer_prompt,
    sha256_text,
    stage_metrics,
)


class BeamOfficialAnalysisTests(unittest.TestCase):
    def test_prompt_hashes_match_fixed_pipeline(self):
        self.assertEqual(sha256_text(ANSWER_GENERATION_FOR_RAG), ANSWER_PROMPT_SHA256)
        self.assertEqual(
            sha256_text(UNIFIED_LLM_JUDGE_BASE_PROMPT), JUDGE_PROMPT_SHA256
        )

    def test_answer_prompt_uses_search_context_and_question(self):
        prompt = render_answer_prompt(
            {
                "id": "q1",
                "question": "What changed?",
                "context": ["First memory", "Second memory"],
            }
        )
        self.assertIn("CONTEXT:\nFirst memory\nSecond memory", prompt)
        self.assertIn("QUESTION:\nWhat changed?", prompt)
        self.assertNotIn("<context>", prompt)
        self.assertNotIn("<question>", prompt)

    def test_numeric_evidence_ids_map_to_persisted_session_turns(self):
        sessions = {("beam_100k", "beam-18"): [132, 58, 60]}
        groups = evidence_groups(
            "beam_100k",
            "beam-18",
            ["[24, 26, 28]", "[146]", "D3:12"],
            sessions,
        )
        self.assertEqual(
            groups,
            [["D1:25", "D1:27", "D1:29"], ["D2:15"], ["D3:12"]],
        )

    def test_stage_metrics_reports_exact_and_adjacent_support(self):
        metrics = stage_metrics(
            [["D1:25"], ["D2:15"]],
            {"D1:26", "D2:15"},
        )
        self.assertEqual(metrics["marker_hits"], 1)
        self.assertEqual(metrics["group_hits"], 1)
        self.assertFalse(metrics["all_groups"])
        self.assertEqual(metrics["near1_marker_hits"], 2)
        self.assertEqual(metrics["near1_group_hits"], 2)
        self.assertTrue(metrics["near1_all_groups"])


if __name__ == "__main__":
    unittest.main()
