import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src';

describe('Airia Slackbot Worker', () => {
  // Test environment setup
  const testEnv = {
    ...env,
    ENVIRONMENT: 'development',
    AIRIA_API_URL: 'https://example-api.airia.example.com',
    Airia_API_key: 'test-api-key',
    Slack_Signing_Secret: 'test-signing-secret',
    Slack_Bot_Token: 'test-bot-token'
  };

  // Test for non-existent route
  it('404 on unknown routes', async () => {
    const request = new Request('http://example.com/unknown');
    const ctx = createExecutionContext();
    
    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
  });

  // Test route in development
  it('test route works in development environment', async () => {
    const request = new Request('http://example.com/test');
    const ctx = createExecutionContext();
    
    const response = await worker.fetch(request, testEnv, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.status).toBe('ok');
    expect(data.environment).toBe('development');
  });
  
  // Test route in production (should 404)
  it('test route is blocked in production environment', async () => {
    const request = new Request('http://example.com/test');
    const prodEnv = { ...testEnv, ENVIRONMENT: 'production' };
    const ctx = createExecutionContext();
    
    const response = await worker.fetch(request, prodEnv, ctx);
    await waitOnExecutionContext(ctx);
    
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Not found');
  });
});
