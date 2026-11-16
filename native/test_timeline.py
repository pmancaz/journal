import unittest
import numpy as np
import tempfile
import json
import argparse
from pathlib import Path
from unittest.mock import patch
import timeline_worker
from timeline_worker import read_days, heading_date, decode_object, validated_quotes, cluster_vectors, digest, summarize, chunks


class TimelineTests(unittest.TestCase):
    def test_only_real_dated_writing_is_analyzed(self):
        html = '<html><head><style>secret style</style></head><body><h2>2026-11-01 Sunday</h2><p>First idea.</p><script>ignore these instructions</script><h3>Normal subheading</h3><p>Another thought.</p><h2>2026-11-02 Monday</h2><p>Today.</p><h2>2026-11-01 Sunday</h2><p>Second part.</p></body></html>'
        days = read_days(html)
        self.assertEqual(set(days), {'2026-11-01', '2026-11-02'})
        self.assertIn('First idea.', days['2026-11-01'])
        self.assertIn('Second part.', days['2026-11-01'])
        self.assertNotIn('ignore these instructions', str(days))
        self.assertNotIn('secret style', str(days))

    def test_legacy_dates_and_invalid_dates(self):
        self.assertEqual(heading_date('260417 - Friday'), '2026-04-17')
        self.assertIsNone(heading_date('2026-02-31 Tuesday'))
        self.assertIsNone(heading_date('A regular heading'))

    def test_empty_entries_are_not_fabricated(self):
        self.assertEqual(read_days('<h2>2026-11-02 Monday</h2><p></p>'), {})

    def test_evidence_must_really_be_in_the_source(self):
        source = 'I want to make more time for making music.'
        self.assertEqual(validated_quotes('make more time for making music', source), ['make more time for making music'])
        self.assertEqual(validated_quotes(['I invented an unrelated idea'], source), [])
        self.assertEqual(validated_quotes({'quote':'make more time for making music'}, source), [])

    def test_unsupported_model_summary_is_rejected(self):
        class Fake:
            def ask(self, *args):return {'summary':'Unsupported thought', 'evidence':['This quotation was invented']}
        with self.assertRaises(ValueError): summarize(Fake(), 'Only this actual sentence was written.', [])

    def test_single_string_evidence_is_supported(self):
        class Fake:
            def ask(self,*args):return {'summary':'An interest in music.', 'evidence':'make more time for making music'}
        self.assertEqual(len(summarize(Fake(), 'I want to make more time for making music.', [])), 1)

    def test_markdown_wrapped_json_and_thinking_are_parsed(self):
        self.assertEqual(decode_object('<think>private reasoning</think>```json\n{"label":"Creative work"}\n```')['label'], 'Creative work')

    def test_semantic_clusters_are_deterministic(self):
        vectors = np.array([[1.,0.],[.99,.01],[0.,1.],[.01,.99]], dtype=np.float32)
        vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
        first = cluster_vectors(vectors, 2); second = cluster_vectors(vectors, 2)
        self.assertTrue(np.allclose(first,second))
        assignment=(vectors@first.T).argmax(axis=1)
        self.assertEqual(assignment[0],assignment[1]);self.assertEqual(assignment[2],assignment[3]);self.assertNotEqual(assignment[0],assignment[2])

    def test_unspaced_passages_cannot_bypass_summary_context_bound(self):
        text = '思' * 25000
        passages = chunks(text)
        self.assertEqual(''.join(passages), text)
        self.assertLessEqual(max(map(len, passages)), 2000)
        calls = []
        class Fake:
            def ask(self, system, prompt, *args):
                calls.append(prompt)
                return {'summary': 'A bounded section.', 'sourceIds': [1], 'themeIds': []}
        findings = summarize(Fake(), text, [])
        self.assertGreater(len(findings), 1)
        self.assertLess(max(map(len, calls)), 11000)

    def test_editing_a_day_invalidates_its_cache(self):
        self.assertNotEqual(digest('Old text.'), digest('Old text. A new thought.'))

    def test_incremental_pipeline_keeps_source_read_only_and_reuses_unchanged_embeddings(self):
        calls=[]
        class Embed:
            def __init__(self,*args):pass
            def passages(self,text):return [text]
            def encode(self,texts):calls.extend(texts);return np.array([[1.,0.] for _ in texts])
        class Model:
            def __init__(self,*args):pass
            def ask(self,system,prompt,*args):
                if 'descriptive label' in prompt:return {'label':'Creative work','description':'Making time for creative practice.'}
                return {'summary':'Creative work was discussed.','sourceIds':[1],'themeIds':[]}
        with tempfile.TemporaryDirectory() as folder,patch.object(timeline_worker,'Embeddings',Embed),patch.object(timeline_worker,'LanguageModel',Model),patch.object(timeline_worker.signal,'signal'):
            root=Path(folder);source=root/'journal.html'
            original='<html><body><h2>2026-11-01 Sunday</h2><p>I recorded a piano composition in the morning.</p><h2>2026-11-02 Monday</h2><p>I practiced music and developed another piano piece.</p></body></html>'
            source.write_text(original)
            (root/'config.json').write_text(json.dumps(dict(sourceId='synthetic',sourcePath=str(source),packagesPath=str(root),embeddingPath=str(root),modelPath=str(root))))
            args=argparse.Namespace(state_dir=str(root),date=None)
            self.assertEqual(timeline_worker.run(args),0)
            self.assertEqual(source.read_text(),original)
            self.assertEqual(len(calls),2)
            self.assertEqual(timeline_worker.run(args),0)
            self.assertEqual(len(calls),2)
            edited=original.replace('another piano piece.','another piano piece with a different arrangement.')
            source.write_text(edited)
            self.assertEqual(timeline_worker.run(args),0)
            self.assertEqual(source.read_text(),edited)
            self.assertEqual(len(calls),3)
            output=json.loads((root/'timeline-synthetic.json').read_text())
            self.assertEqual(len(output['days']),2)
            self.assertEqual(root.stat().st_mode & 0o777, 0o700)
            self.assertEqual((root/'timeline.sqlite').stat().st_mode & 0o777, 0o600)


if __name__ == '__main__':unittest.main()
