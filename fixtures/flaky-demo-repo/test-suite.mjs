const mode = process.env.FIXTURE_MODE ?? 'stable';

if (mode === 'stable') process.exit(0);
if (mode === 'failing') {
  console.error('deliberate failure');
  process.exit(1);
}
if (mode === 'flaky') process.exit(Number(process.env.FIXTURE_OUTCOME ?? Math.round(Math.random())));
if (mode === 'timeout') await new Promise(() => {});
if (mode === 'order-dependent' && process.env.FIXTURE_SHARED_STATE !== 'ready') {
  console.error('shared state was not initialized');
  process.exit(1);
}
process.exit(0);
