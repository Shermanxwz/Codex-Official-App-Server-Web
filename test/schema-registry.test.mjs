import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMethods } from '../src/schema-registry.mjs';

test('extractMethods derives every official method from oneOf variants', () => {
  const schema={
    definitions:{A:{type:'object',properties:{x:{type:'string'}},required:['x']}},
    oneOf:[
      {title:'ARequest',description:'alpha',properties:{method:{enum:['alpha/run']},params:{$ref:'#/definitions/A'}}},
      {title:'BRequest',properties:{method:{enum:['beta/list']},params:{type:'object'}}},
    ],
  };
  const methods=extractMethods(schema);
  assert.deepEqual(methods.map(x=>x.method),['alpha/run','beta/list']);
  assert.equal(methods[0].paramsSchema.required[0],'x');
  assert.equal(methods[0].description,'alpha');
});

test('extractMethods ignores malformed schema alternatives', () => {
  assert.deepEqual(extractMethods({oneOf:[{}, {properties:{method:{enum:[]}}}]}),[]);
});
