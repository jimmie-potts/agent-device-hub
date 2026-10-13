import {Annotation, Command, END, START, StateGraph, interrupt} from '@langchain/langgraph';
import {openModuleDatabaseFile} from '@jimmie-potts/sdk';
import {SqliteCheckpointSaver} from '../src/assistant/checkpointer.js';

const file = process.argv[2];
if (file === undefined) throw new Error('missing-fixture-file');
const database = openModuleDatabaseFile(file);
const shape = Annotation.Root({task: Annotation<string>, answer: Annotation<string>});
const graph = new StateGraph(shape)
  .addNode('question', () => ({answer: interrupt<{questionId: string; text: string}, string>({questionId: 'question-1', text: 'Which fixture?'})}))
  .addEdge(START, 'question').addEdge('question', END).compile({checkpointer: new SqliteCheckpointSaver(database)});
const config = {configurable: {thread_id: 'task-1'}, durability: 'sync' as const};
if (process.argv[3] === 'pause') {
  await graph.invoke({task: 'task-1'}, config);
  // Exit without closing SQLite or projecting domain state: durable checkpoints must survive this gap.
  process.exit(17);
}
const before = await graph.getState(config);
if (process.argv[3] === 'inspect') {
  process.stdout.write(JSON.stringify(before));
} else {
  const result = await graph.invoke(new Command({resume: 'synthetic-answer'}), config);
  process.stdout.write(JSON.stringify({before, result}));
}
database.close();
