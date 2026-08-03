/**
 * Scratch Test Script: Temporary ID Mapping & Cascading Reference Rewriting
 */

const fs = require('fs');
const path = require('path');

// Minimal mock DOM / IndexedDB environment for testing SDK methods
global.window = global;
global.window.addEventListener = () => {};
global.navigator = { onLine: true };
global.document = {
  currentScript: null,
  querySelector: () => null,
  addEventListener: () => {},
  head: { appendChild: () => {} }
};
global.localStorage = {
  getItem: () => null,
  setItem: () => {}
};
global.location = { origin: 'http://localhost:3000', href: 'http://localhost:3000' };

// Load SDK script
const sdkCode = fs.readFileSync(path.join(__dirname, '../public/sdk/asg-offline.js'), 'utf8');
eval(sdkCode);

const sdk = window.ASGOffline;

console.log('🧪 Testing Temporary ID Mapping & Cascading Rewriting Engine...\n');

// 1. Record parent mapping (tmp_cust_101 -> 8472)
sdk._recordTemporaryIdMapping('tmp_cust_101', 8472);

// 2. Define dependent child operation referencing parent's temp ID
const childOp = {
  operationId: 'posa_op_child_001',
  collection: 'orders',
  action: 'CREATE',
  recordId: 'tmp_ord_501',
  dependencyId: 'posa_op_parent_001',
  payload: {
    id: 'tmp_ord_501',
    customerId: 'tmp_cust_101',
    orderTotal: 299,
    items: [
      { sku: 'ITEM-A', assignedUser: 'tmp_cust_101' }
    ]
  },
  integration: {
    urlPattern: 'https://api.myshop.com/customers/tmp_cust_101/orders'
  }
};

console.log('Original Child Operation before rewrite:');
console.log(JSON.stringify(childOp, null, 2));

// 3. Rewrite operation using tempIdMap
const rewrittenOp = sdk._rewriteTemporaryIdsInOperation(childOp);

console.log('\nRewritten Child Operation after cascading temp ID resolution:');
console.log(JSON.stringify(rewrittenOp, null, 2));

// Assertions
const assert = require('assert');
assert.strictEqual(rewrittenOp.payload.customerId, 8472, 'payload.customerId must be rewritten to 8472');
assert.strictEqual(rewrittenOp.payload.items[0].assignedUser, 8472, 'payload nested reference must be rewritten to 8472');
assert.strictEqual(rewrittenOp.integration.urlPattern, 'https://api.myshop.com/customers/8472/orders', 'urlPattern must be rewritten with server customer ID');

console.log('\n✅ ALL TEMPORARY ID CASCADING REWRITE TESTS PASSED PERFECTLY!');
process.exit(0);
