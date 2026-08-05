import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path


if importlib.util.find_spec("tqdm") is None:
    tqdm_module = types.ModuleType("tqdm")
    tqdm_module.tqdm = lambda *args, **kwargs: None
    sys.modules["tqdm"] = tqdm_module


MODULE_PATH = Path(__file__).with_name("longmemeval_frozen_eval.py")
SPEC = importlib.util.spec_from_file_location("longmemeval_frozen_eval", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
EVAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EVAL)


def fixture() -> dict:
    memory = {
        "memoryId": "m-1",
        "contentHash": "hash-1",
        "role": "user",
        "content": "source fact",
        "metadata": {},
    }
    return {
        "results": [
            {
                "question_id": "q-1",
                "retrieval": {
                    "scopeId": "scope-1",
                    "question": "What was selected?",
                    "searchedMemories": [memory],
                    "evidence": [memory],
                    "citations": [
                        {"memoryId": "m-1", "supports": "the selected fact"}
                    ],
                    "status": "sufficient",
                    "evidenceSummary": "One source fact was selected.",
                },
            }
        ]
    }


class FrozenInputPreparationTest(unittest.TestCase):
    def prepare(self, *, selection: bool = False) -> dict:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "results.json"
            output = root / "input.json"
            source.write_text(json.dumps(fixture()), encoding="utf-8")
            EVAL.prepare_frozen_input(
                source,
                output,
                include_selection_data=selection,
            )
            return json.loads(output.read_text(encoding="utf-8"))

    def test_selection_data_is_explicit_and_gold_isolated(self) -> None:
        prepared = self.prepare(selection=True)
        self.assertTrue(prepared["selection_data_present"])
        self.assertFalse(prepared["gold_fields_present"])
        self.assertFalse(prepared["original_answer_fields_present"])
        record = prepared["records"][0]
        self.assertIn("selection_package", record)
        self.assertIn("selected_memories", record)
        self.assertIn("selection_data_hash", record)
        EVAL.validate_reanswer_source(prepared, "selection-aware-v3")
        with self.assertRaisesRegex(ValueError, "without selection data"):
            EVAL.validate_reanswer_source(prepared, "exact-searched-memories")

    def test_exact_input_contains_no_selection_data(self) -> None:
        prepared = self.prepare()
        self.assertNotIn("selection_data_present", prepared)
        self.assertNotIn("evidence_packages_present", prepared)
        EVAL.validate_reanswer_source(prepared, "exact-searched-memories")
        with self.assertRaisesRegex(ValueError, "requires prepared selection data"):
            EVAL.validate_reanswer_source(prepared, "selection-aware-v3")

    def test_raw_text_plus_products_contains_only_natural_language_products(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            results = root / "results.json"
            raw_input = root / "raw.json"
            output = root / "products.json"
            results.write_text(json.dumps(fixture()), encoding="utf-8")
            EVAL.prepare_frozen_input(results, raw_input)
            EVAL.attach_text_products(raw_input, results, output)
            prepared = json.loads(output.read_text(encoding="utf-8"))

        EVAL.validate_reanswer_source(prepared, "raw-text-plus-agent-products")
        record = prepared["records"][0]
        self.assertEqual(
            record["agent_text_products"],
            {
                "evidence_summary": "One source fact was selected.",
                "supports": ["the selected fact"],
            },
        )
        prompt = EVAL.answer_prompt(record, "raw-text-plus-agent-products")
        self.assertIn("source fact", prompt)
        self.assertIn("One source fact was selected.", prompt)
        self.assertIn("the selected fact", prompt)
        self.assertNotIn("m-1", prompt)
        self.assertNotIn("status=sufficient", prompt)
        with self.assertRaisesRegex(ValueError, "without selection data"):
            EVAL.validate_reanswer_source(prepared, "raw-text-memories")


if __name__ == "__main__":
    unittest.main()
