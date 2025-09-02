import { storeText } from '../src/walrus.js';

const run = async () => {
  const res = await storeText('Hello from Veralux backend!');
  console.log(res);
};
run().catch(console.error);
