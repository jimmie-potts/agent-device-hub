// One contender in the receipt-lock race: increments the receipt's counter `rounds`
// times inside ProofStore.update, holding the lock for a 30 ms critical section.
import {ProofStore} from '../../dist/receipt.js';

const [dir, rounds] = process.argv.slice(2);
const store = new ProofStore(dir);
let applied = 0;
const errors = [];
for (let i = 0; i < Number(rounds); i++) {
  try {
    await store.update(async receipt => {
      receipt.counter = (receipt.counter ?? 0) + 1;
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    applied++;
  } catch (error) {
    errors.push(error.message);
  }
}
process.stdout.write(JSON.stringify({applied, errors}) + '\n');
