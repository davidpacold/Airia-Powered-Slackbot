/**
 * Airia-Powered Slackbot
 * 
 * A Cloudflare Worker that connects Slack to the Airia API, enabling
 * teams to interact with Airia's capabilities directly from Slack.
 * 
 * This worker handles:
 * - Slack slash commands (/ask-airia)
 * - Slack Direct Messages to the bot
 * - Mentions of the bot in channels
 * - Slack home tab app configuration
 * 
 * Security features:
 * - Verifies Slack request signatures
 * - Uses environment variables for all secrets
 * - Configurable environment-based logging
 * - Production/development environment separation
 */

import crypto from 'crypto';

/**
 * Partial key logging to avoid exposing entire secrets in logs
 * Only for development environments - remove in production
 */
function partialKey(key) {
  if (!key) return 'undefined';
  return key.slice(0, 3) + '...'; // Show only first 3 chars
}

/**
 * Verbose logging function for development mode
 * Controls logging level based on environment
 * SECURITY NOTE: Development only - disabled in production to avoid leaking secrets
 */
function isVerboseLogging(env) {
  return env.ENVIRONMENT !== 'production' && env.VERBOSE_LOGGING !== 'false';
}

/**
 * Logger to confirm env vars are set
 * SECURITY NOTE: For development only - should be disabled in production
 * as it could leak partial secrets to logs
 */
function logEnvValues(env) {
  // Don't log in production
  if (env.ENVIRONMENT === 'production') {
    console.log('[ENV] Environment: production (skipping detailed logs)');
    return;
  }
  
  console.log('[ENV] AIRIA_API_URL is set:', !!env.AIRIA_API_URL);
  console.log('[ENV] Airia_API_key is set:', !!env.Airia_API_key);
  console.log('[ENV] Slack_Signing_Secret is set:', !!env.Slack_Signing_Secret);
  console.log('[ENV] Slack_Bot_Token is set:', !!env.Slack_Bot_Token);
  console.log('[ENV] VERBOSE_LOGGING:', env.VERBOSE_LOGGING !== 'false' ? 'enabled' : 'disabled');
  
  if (isVerboseLogging(env)) {
    console.log('[ENV-VERBOSE] Additional debug logging is enabled');
  }
}

/**
 * Worker in Modules format
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Test route - only enabled in development environments
    if (url.pathname === '/test' && env.ENVIRONMENT !== 'production') {
      console.log('[TEST] Received /test request');
      
      // Check environment but don't log sensitive details
      console.log('[TEST] Environment:', env.ENVIRONMENT || 'not set');
      
      // Return basic health check response
      return new Response(JSON.stringify({ 
        status: 'ok',
        environment: env.ENVIRONMENT || 'development'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    // Block test route in production
    if (url.pathname === '/test' && env.ENVIRONMENT === 'production') {
      console.warn('[SECURITY] Test route accessed in production');
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname === '/slack') {
      console.log('[SLACK] Received /slack request');
      logEnvValues(env);

      // 1) Get the raw body first for all request types
      const rawBody = await request.text();
      
      // Special handling for URL verification - skip signature checks
      try {
        const jsonBody = JSON.parse(rawBody);
        if (jsonBody.type === 'url_verification') {
          console.log('[SLACK] Detected URL verification challenge!');
          return new Response(JSON.stringify({ challenge: jsonBody.challenge }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (e) {
        // Not JSON or not a challenge - continue with normal flow
        console.log('[SLACK] Not a URL verification challenge, continuing...');
      }

      // 2) Normal Slack signature checks for non-challenge requests
      const timestamp = request.headers.get('X-Slack-Request-Timestamp');
      const slackSignature = request.headers.get('X-Slack-Signature');

      // Skip signature check if secret is not set (for initial URL verification)
      if (!env.Slack_Signing_Secret) {
        console.warn('[SLACK] Signing secret not set - skipping signature verification');
      } else {
        // Basic timestamp check (300s)
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - timestamp) > 300) {
          console.error('[SLACK] Timestamp too old:', timestamp);
          return new Response('Invalid request (timestamp too old)', { status: 400 });
        }

        // Verify Slack signature
        const baseString = `v0:${timestamp}:${rawBody}`;
        const computedHash = `v0=${crypto
          .createHmac('sha256', env.Slack_Signing_Secret)
          .update(baseString)
          .digest('hex')}`;

        if (computedHash !== slackSignature) {
          console.error('[SLACK] Invalid Slack signature');
          return new Response('Invalid request (invalid signature)', { status: 401 });
        }
        console.log('[SLACK] Slack signature verified.');
      }

      // 3) Parse Slack payload
      let payload;
      const contentType = request.headers.get('Content-Type') || '';
      if (contentType.includes('application/json')) {
        // Already parsed for challenge check
        payload = JSON.parse(rawBody);
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(rawBody);
        payload = Object.fromEntries(params.entries());
        
        // For payloads containing JSON strings (like interactive components)
        if (payload.payload) {
          try {
            payload = JSON.parse(payload.payload);
          } catch (err) {
            console.error('[SLACK] Error parsing payload JSON:', err);
          }
        }
      } else {
        console.error('[SLACK] Invalid content type:', contentType);
        return new Response('Invalid request format', { status: 400 });
      }

      // Slack URL verification (redundant but keeping for clarity)
      if (payload.type === 'url_verification') {
        console.log('[SLACK] Responding to Slack URL verification challenge...');
        return new Response(JSON.stringify({ challenge: payload.challenge }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Slash command /ask-airia
      if (payload.command && payload.command === '/ask-airia') {
        console.log('[SLASH] /ask-airia slash command');
        // Return 200 immediately
        const ack = new Response('OK', { status: 200 });
        ctx.waitUntil(processSlashCommand(payload, env));
        return ack;
      }

      // Interactive components (message actions, shortcuts, modals, etc.)
      if (payload.type === 'message_action' || payload.type === 'block_actions' || 
          payload.type === 'shortcut' || payload.type === 'workflow_step' ||
          payload.type === 'view_submission') {
        console.log('[INTERACTIVE] Interactive component triggered:', payload.type);
        
        // Handle message action: "Summarize"
        if (payload.type === 'message_action' && payload.callback_id === 'summarize_thread') {
          // For message actions, return an empty JSON object with content-type application/json
          // This ensures Slack doesn't show an error dialog
          const ack = new Response('{}', { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
          ctx.waitUntil(processThreadSummary(payload, env));
          return ack;
        } 
        // Handle global shortcut: "Ask AI Assistant"
        else if (payload.type === 'shortcut' && payload.callback_id === 'ask_airia_shortcut') {
          // For shortcuts, use JSON response too
          const ack = new Response('{}', { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
          // IMPORTANT: For shortcuts, we need to respond quickly
          // So we'll start processing after sending the initial response
          ctx.waitUntil(processAskAiriaShortcut(payload, env));
          return ack;
        } 
        // Handle workflow step: "Generate response"
        else if (payload.type === 'workflow_step' && payload.callback_id === 'generate_response') {
          const ack = new Response('{}', { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
          ctx.waitUntil(processWorkflowStep(payload, env));
          return ack;
        }
        // Handle modal submissions
        else if (payload.type === 'view_submission') {
          console.log('[MODAL] View submission received:', payload.view.callback_id);
          
          // Check which modal was submitted using the callback_id
          if (payload.view.callback_id === 'ask_ai_assistant_modal') {
            // Process the AI Assistant question modal
            // We'll do this in the background to avoid blocking
            const ack = new Response('{}', { 
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
            ctx.waitUntil(handleViewSubmission(payload, env));
            return ack;
          } else {
            // For any other modal types, handle synchronously
            console.log('[MODAL] Unknown modal type:', payload.view.callback_id);
            return new Response('{}', {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            });
          }
        } else {
          console.log('[INTERACTIVE] Unhandled interactive component:', payload);
          return new Response('{}', { 
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Link unfurling
      if (payload.type === 'event_callback' && payload.event && payload.event.type === 'link_shared') {
        console.log('[UNFURL] Link shared event:', payload.event);
        const ack = new Response('OK', { status: 200 });
        ctx.waitUntil(processLinkUnfurl(payload.event, env));
        return ack;
      }
      
      // Event callback
      if (payload.type === 'event_callback') {
        const slackEvent = payload.event;
        console.log('[SLACK EVENT] Received event:', slackEvent);

        // Ignore bot's own messages
        if (slackEvent.bot_id) {
          console.log('[SLACK EVENT] Bot message, ignoring');
          return new Response('Bot message ignored', { status: 200 });
        }

        // Home tab
        if (slackEvent.type === 'app_home_opened') {
          console.log('[SLACK EVENT] app_home_opened for user:', slackEvent.user);
          const ack = new Response('OK', { status: 200 });
          ctx.waitUntil(updateHomeTab(slackEvent, env));
          return ack;
        }

        // DM
        if (slackEvent.type === 'message' && slackEvent.channel_type === 'im') {
          console.log(`[SLACK EVENT] DM from user ${slackEvent.user}: ${slackEvent.text}`);
          const ack = new Response('OK', { status: 200 });
          ctx.waitUntil(processDM(slackEvent, env));
          return ack;
        }

        // @mention
        if (slackEvent.type === 'app_mention') {
          console.log(`[SLACK EVENT] @mention from user ${slackEvent.user}: ${slackEvent.text}`);
          const ack = new Response('OK', { status: 200 });
          // We'll do ephemeral "thinking" + final answer
          ctx.waitUntil(processMention(slackEvent, env));
          return ack;
        }

        console.warn('[SLACK EVENT] Unhandled event type:', slackEvent.type);
        return new Response('Unhandled event', { status: 400 });
      }

      console.warn('[SLACK] Unhandled payload:', payload);
      return new Response('Unhandled Slack payload', { status: 400 });
    }

    // Not /slack or /test => 404
    console.warn('[WORKER] No matching route:', url.pathname);
    return new Response('Not found', { status: 404 });
  }
};

/**
 * Processes the /ask-airia slash command in background
 */
async function processSlashCommand(payload, env) {
  console.log('[SLASH] Processing slash command in background. userInput:', payload.text);
  try {
    const aiRes = await fetch(env.AIRIA_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': env.Airia_API_key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userInput: payload.text, asyncOutput: false }),
    });

    const rawText = await aiRes.text();
    console.log('[SLASH] Raw AI response:', rawText);

    if (!aiRes.ok) {
      console.error('[SLASH] Airia API error:', aiRes.status, aiRes.statusText);
      await fetch(payload.response_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `Airia API returned an error: ${aiRes.status} - ${aiRes.statusText}`,
        }),
      });
      return;
    }

    const aiJson = JSON.parse(rawText);
    console.log('[SLASH] AI parsed JSON:', aiJson);

    // Respond to Slack's response_url
    await fetch(payload.response_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Result from AI Assistant:\n*${aiJson.result}*\nIs Backup Pipeline: ${
          aiJson.isBackupPipeline ? 'Yes' : 'No'
        }`,
      }),
    });
    console.log('[SLASH] Done sending slash command result');
  } catch (err) {
    console.error('[SLASH] Error in slash command logic:', err);
  }
}

/**
 * Processes direct messages in background
 */
async function processDM(event, env) {
  console.log('[DM] user text:', event.text);
  try {
    const aiRes = await fetch(env.AIRIA_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': env.Airia_API_key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userInput: event.text, asyncOutput: false }),
    });

    const rawText = await aiRes.text();
    console.log('[DM] Raw AI response:', rawText);

    if (!aiRes.ok) {
      console.error('[DM] AI error:', aiRes.status, aiRes.statusText);
      await postSlackMessage(env, event.channel, `AI error: ${aiRes.status}`);
      return;
    }

    const aiJson = JSON.parse(rawText);
    const reply = `You asked: "${event.text}"\n\nResult: *${aiJson.result}*\nIs Backup Pipeline: ${
      aiJson.isBackupPipeline ? 'Yes' : 'No'
    }`;
    await postSlackMessage(env, event.channel, reply);
    console.log('[DM] Replied to user DM');
  } catch (err) {
    console.error('[DM] Error in processDM:', err);
    await postSlackMessage(env, event.channel, `Error in processDM: ${err}`);
  }
}

/**
 * Processes @mentions in background
 *  1) Immediately post ephemeral "thinking" face
 *  2) Then post final AI result
 */
async function processMention(event, env) {
  console.log('[MENTION] user text:', event.text);

  // (1) Immediately send ephemeral "thinking" message
  try {
    // Check if this is a message in a thread, if so place the ephemeral in the thread
    const thread_ts = event.thread_ts || event.ts;
    
    await postEphemeralMessage(env, {
      channel: event.channel,
      user: event.user,
      text: ':thinking_face: Working on it...',
      thread_ts: thread_ts // Include to place ephemeral in thread if applicable
    });
    console.log('[MENTION] Sent ephemeral thinking message', thread_ts ? `in thread ${thread_ts}` : '');
  } catch (err) {
    console.error('[MENTION] Error sending ephemeral message:', err);
  }

  // (2) Do the AI call
  try {
    const aiRes = await fetch(env.AIRIA_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': env.Airia_API_key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userInput: event.text, asyncOutput: false }),
    });

    const rawText = await aiRes.text();
    console.log('[MENTION] Raw AI response:', rawText);

    if (!aiRes.ok) {
      console.error('[MENTION] AI error:', aiRes.status, aiRes.statusText);
      await postSlackMessage(env, event.channel, `AI error: ${aiRes.status}`);
      return;
    }

    const aiJson = JSON.parse(rawText);
    const msg = `You asked: "${event.text}"\n\n*${aiJson.result}*\nIs Backup Pipeline: ${
      aiJson.isBackupPipeline ? 'Yes' : 'No'
    }`;
    await postSlackMessage(env, event.channel, msg);
    console.log('[MENTION] Replied to user mention');
  } catch (err) {
    console.error('[MENTION] Error in processMention:', err);
    await postSlackMessage(env, event.channel, `Error in mention logic: ${err}`);
  }
}

/**
 * Updates the Slack home tab with instructions/examples
 */
async function updateHomeTab(event, env) {
  console.log('[HOME] Updating home tab for user:', event.user);

  const homeView = {
    type: 'home',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Welcome to the AI Assistant!* :wave:\n\nThis bot helps you interact with AI services effortlessly.',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Available Features:*\n\nHere\'s how you can use the AI Assistant:',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*1. Slash Command:*\nUse `/ask-airia [your question]` to ask a question directly.\n\n_Example:_ `/ask-airia What is the capital of Georgia?`',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*2. @Mention in a Channel:*\nMention the bot in a channel and ask a question.\n\n_Example:_ `@AI Assistant What is the weather today?`',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*3. Direct Message:*\nSend a direct message to the bot with your question.\n\n_Example:_ `What is machine learning?`',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: ':gear: *Need help?* Contact your administrator for support.',
          },
        ],
      },
    ],
  };

  await fetch('https://slack.com/api/views.publish', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.Slack_Bot_Token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: event.user,
      view: homeView,
    }),
  });
  console.log('[HOME] Updated home tab content');
}

/**
 * Post a message to Slack in background tasks
 * @param {Object} env - Environment variables
 * @param {string} channel - Slack channel ID
 * @param {string} text - Message text
 * @param {string} [thread_ts] - Optional thread timestamp to reply to a thread
 * @param {Object} [blocks] - Optional blocks for rich formatting
 */
async function postSlackMessage(env, channel, text, thread_ts = null, blocks = null) {
  console.log('[SLACK POST] channel:', channel, ' text:', text, thread_ts ? ` (in thread: ${thread_ts})` : '');
  
  const message = { 
    channel, 
    text 
  };
  
  // Add thread_ts if provided (for thread replies)
  if (thread_ts) {
    // Validate the timestamp format before using it
    // Slack timestamps can have various formats but should always have a dot separator
    const isValidTimestamp = (ts) => {
      // Basic validation: string with numbers and a dot
      return typeof ts === 'string' && /^\d+\.\d+$/.test(ts);
    };
    
    // More flexible validation as backup
    const isValidTimestampFallback = (ts) => {
      // Allow any string with digits and dots that's between 10-20 chars
      return typeof ts === 'string' && 
             ts.length >= 10 && 
             ts.length <= 20 && 
             ts.includes('.');
    };
    
    if (isValidTimestamp(thread_ts)) {
      message.thread_ts = thread_ts;
    } else if (isValidTimestampFallback(thread_ts)) {
      console.log('[SLACK POST] Using non-standard timestamp format:', thread_ts);
      message.thread_ts = thread_ts;
    } else {
      console.warn('[SLACK POST] Invalid thread_ts format:', thread_ts, '- skipping thread reply');
      throw new Error(`Invalid thread_ts format: ${thread_ts}`);
    }
  }
  
  // Add blocks if provided (for rich formatting)
  if (blocks) {
    message.blocks = blocks;
  }
  
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.Slack_Bot_Token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });
  
  // Check for API errors
  if (!response.ok) {
    const errorText = await response.text();
    console.error('[SLACK POST] HTTP error posting message:', response.status, errorText);
    throw new Error(`Slack API error: ${response.status} - ${errorText}`);
  }
  
  const result = await response.json();
  if (!result.ok) {
    console.error('[SLACK POST] Slack API error:', result.error);
    throw new Error(`Slack API error: ${result.error}`);
  }
  
  return result;
}

/**
 * Post an ephemeral message to Slack (visible only to `user` in `channel`)
 * Now supports thread_ts parameter to place ephemeral messages in threads
 */
async function postEphemeralMessage(env, { channel, user, text, thread_ts = null }) {
  console.log('[SLACK EPHEMERAL] channel:', channel, ' user:', user, ' text:', text, thread_ts ? ` (in thread: ${thread_ts})` : '');
  
  const payload = { channel, user, text };
  
  // Add thread_ts if provided to make ephemeral appear in a thread
  if (thread_ts) {
    // Similar validation as in postSlackMessage
    const isValidTimestamp = (ts) => {
      return typeof ts === 'string' && /^\d+\.\d+$/.test(ts);
    };
    
    // More flexible validation as backup
    const isValidTimestampFallback = (ts) => {
      return typeof ts === 'string' && 
             ts.length >= 10 && 
             ts.length <= 20 && 
             ts.includes('.');
    };
    
    if (isValidTimestamp(thread_ts)) {
      payload.thread_ts = thread_ts;
    } else if (isValidTimestampFallback(thread_ts)) {
      console.log('[SLACK EPHEMERAL] Using non-standard timestamp format:', thread_ts);
      payload.thread_ts = thread_ts;
    } else {
      console.warn('[SLACK EPHEMERAL] Invalid thread_ts format:', thread_ts, '- ephemeral will appear in main channel');
    }
  }
  
  const response = await fetch('https://slack.com/api/chat.postEphemeral', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.Slack_Bot_Token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const json = await response.json();
  console.log('[SLACK EPHEMERAL] postEphemeral response:', json);
}

/**
 * Handles "Summarize" message action
 * This allows users to summarize threads, single messages, or recent conversations
 */
async function processThreadSummary(payload, env) {
  console.log('[SUMMARY] Processing summarize request');
  
  try {
    // In verbose mode, log the full payload
    if (isVerboseLogging(env)) {
      console.log('[SUMMARY-VERBOSE] Full payload:', JSON.stringify(payload, null, 2));
    } else {
      console.log('[SUMMARY] Starting summary processing with payload:', JSON.stringify(payload, null, 2).substring(0, 500) + '...');
    }
    
    // 1. Extract basic info from payload
    let channelId, userId, targetTs;
    let isThreadMessage = false;  // Default values before we determine thread status
    let isThreadParent = false;
    let threadTs = null;
    
    // Get channel ID
    if (payload.channel && typeof payload.channel === 'string') {
      channelId = payload.channel;
    } else if (payload.channel && payload.channel.id) {
      channelId = payload.channel.id;
    } else if (payload.message && payload.message.channel) {
      channelId = payload.message.channel;
    } else {
      throw new Error('Could not determine channel ID from payload');
    }
    
    // Get user ID
    if (payload.user && typeof payload.user === 'string') {
      userId = payload.user;
    } else if (payload.user && payload.user.id) {
      userId = payload.user.id;
    } else if (payload.user_id) {
      userId = payload.user_id;
    } else {
      throw new Error('Could not determine user ID from payload');
    }
    
    // Extract the message timestamp - what message was the action performed on?
    if (payload.message_ts) {
      targetTs = payload.message_ts;
    } else if (payload.message && payload.message.ts) {
      targetTs = payload.message.ts;
    } else if (payload.container && payload.container.message_ts) {
      targetTs = payload.container.message_ts;
    } else {
      console.warn('[SUMMARY] Could not find target timestamp, will use recent conversation');
    }
    
    // Determine if this is a thread message - now guaranteed to be initialized
    if (payload.message && payload.message.thread_ts) {
      isThreadMessage = true;
      threadTs = payload.message.thread_ts;
      isThreadParent = (payload.message.thread_ts === payload.message.ts);
      console.log('[SUMMARY] Detected thread context:', { isThreadMessage, isThreadParent, threadTs });
    }
    
    // Inform the user we're working on it
    // If we have a thread_ts (targetTs or threadTs), use it for the ephemeral message to place it in the thread
    const threadForEphemeral = isThreadMessage ? (threadTs || targetTs) : targetTs;
    
    console.log('[SUMMARY] Sending ephemeral with thread context:', { 
      threadForEphemeral, 
      isThreadMessage, 
      threadTs, 
      targetTs 
    });
    
    await postEphemeralMessage(env, {
      channel: channelId,
      user: userId,
      text: `:thinking_face: Processing your summary request...`,
      thread_ts: threadForEphemeral // Pass thread_ts to place ephemeral in thread
    });
    
    // 2. Try to join the channel (could fail for private channels, which is OK)
    try {
      await fetch(`https://slack.com/api/conversations.join`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channel: channelId }),
      });
    } catch (joinErr) {
      console.log('[SUMMARY] Channel join error (expected for private channels):', joinErr.message);
    }
    
    // 3. Variables to track what we're summarizing
    let messages = [];           // Messages to summarize
    let contextType = 'recent';  // Type of summary (thread, single, recent)
    let replyToTs = null;        // Message to reply to (null = post as new message)
    
    // Thread context is already determined earlier - log the full context again for clarity
    console.log('[SUMMARY] Thread context check:', {
      isThreadMessage,
      isThreadParent,
      threadTs,
      targetTs,
      useForReply: isThreadMessage ? (isThreadParent ? targetTs : threadTs) : targetTs
    });
    
    // Get message contents using a sequence of approaches, from most specific to most general
    
    // APPROACH A: If it's a thread message, get the thread
    if (isThreadMessage && threadTs) {
      try {
        console.log('[SUMMARY] Getting thread messages using thread_ts:', threadTs);
        
        // Log and check the exact values we're sending to the API for debugging
        const requestParams = {
          channel: channelId,
          ts: threadTs
        };
        
        console.log('[SUMMARY] Thread API request parameters:', JSON.stringify(requestParams));
        
        // Validate timestamp format before making API call
        const isValidTS = typeof threadTs === 'string' && /^\d+\.\d+$/.test(threadTs);
        console.log('[SUMMARY] Thread timestamp validation:', {
          threadTs,
          isValid: isValidTS,
          typeof: typeof threadTs
        });
        
        // If timestamp doesn't look valid, try cleaning it
        let cleanTs = threadTs;
        if (!isValidTS && typeof threadTs === 'string') {
          // Extract numbers and dots only, discard everything else
          cleanTs = threadTs.replace(/[^\d.]/g, '');
          // Ensure only one dot
          const parts = cleanTs.split('.');
          if (parts.length > 2) {
            cleanTs = parts[0] + '.' + parts.slice(1).join('');
          }
          console.log('[SUMMARY] Cleaned timestamp:', cleanTs);
          
          // Use cleaned timestamp if it looks valid now
          if (/^\d+\.\d+$/.test(cleanTs)) {
            requestParams.ts = cleanTs;
            console.log('[SUMMARY] Using cleaned timestamp for API call');
          }
        }
        
        // The conversations.replies API requires both 'channel' and 'ts' parameters
        // Make sure both are properly formatted before sending
        if (!requestParams.channel || !requestParams.ts) {
          console.error('[SUMMARY] Missing required parameter:', !requestParams.channel ? 'channel' : 'ts');
          throw new Error('Missing required parameter for thread retrieval');
        }
        
        // Slack expects a specific timestamp format: try to ensure it's correct
        if (requestParams.ts) {
          // Further clean any potential bad formats
          const cleanedTs = requestParams.ts.toString().trim();
          
          // Ensure we have a dot and convert any commans to dots
          if (cleanedTs.includes(',')) {
            requestParams.ts = cleanedTs.replace(',', '.');
            console.log('[SUMMARY] Fixed timestamp format (comma to dot):', requestParams.ts);
          }
          
          // Final check for Slack's expected ts format (numbers.numbers)
          if (!/^\d+\.\d+$/.test(requestParams.ts)) {
            console.warn('[SUMMARY] Timestamp still may not match Slack\'s required format:', requestParams.ts);
            
            // Try one last fix - extract valid numbers and add a dot if needed
            const numbers = requestParams.ts.replace(/[^\d]/g, '');
            if (numbers.length >= 10) {
              // Insert a dot at position 10 if there isn't one already
              const dotPos = Math.min(10, Math.floor(numbers.length/2));
              requestParams.ts = numbers.slice(0, dotPos) + '.' + numbers.slice(dotPos);
              console.log('[SUMMARY] Last attempt timestamp format fix:', requestParams.ts);
            }
          }
        }
        
        console.log('[SUMMARY] Final API request parameters:', JSON.stringify(requestParams));
        
        // For conversations.replies, try both POST and GET methods
        // Some Slack API issues might be related to method or content-type conflicts
        console.log('[SUMMARY] Trying conversations.replies with GET method');
        
        // Use URL parameters instead of JSON body for GET request
        const apiUrl = `https://slack.com/api/conversations.replies?channel=${encodeURIComponent(requestParams.channel)}&ts=${encodeURIComponent(requestParams.ts)}`;
        console.log('[SUMMARY] API URL:', apiUrl);
        
        if (isVerboseLogging(env)) {
          console.log('[SUMMARY-VERBOSE] Thread API full details:', {
            method: 'GET',
            url: apiUrl,
            channelId: requestParams.channel,
            timestamp: requestParams.ts,
            hasToken: !!env.Slack_Bot_Token
          });
        }
        
        const threadResponse = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${env.Slack_Bot_Token}`,
            'Accept': 'application/json',
          }
        });
        
        // Log response status and headers in verbose mode
        if (isVerboseLogging(env)) {
          console.log('[SUMMARY-VERBOSE] Thread API response status:', threadResponse.status);
          console.log('[SUMMARY-VERBOSE] Thread API response headers:', Object.fromEntries([...threadResponse.headers.entries()]));
        }
        
        const threadData = await threadResponse.json();
        
        if (threadData.ok && threadData.messages && threadData.messages.length > 0) {
          console.log('[SUMMARY] Successfully got thread with', threadData.messages.length, 'messages');
          messages = threadData.messages;
          contextType = 'thread';
          
          // For thread parents vs replies, use the appropriate timestamp:
          // - For thread parent: use its own timestamp (targetTs) 
          // - For thread replies: use thread parent timestamp (threadTs)
          replyToTs = isThreadParent ? targetTs : threadTs;
        } else {
          console.warn('[SUMMARY] Failed to get thread:', threadData.error);
          
          // Try an alternative approach specifically for invalid_arguments
          if (threadData.error === 'invalid_arguments' && targetTs && targetTs !== threadTs) {
            console.log('[SUMMARY] Trying alternative timestamp approach with targetTs:', targetTs);
            
            try {
              // Try cleaning the targetTs the same way
              let cleanTargetTs = targetTs;
              if (typeof cleanTargetTs === 'string') {
                cleanTargetTs = cleanTargetTs.trim();
                if (cleanTargetTs.includes(',')) {
                  cleanTargetTs = cleanTargetTs.replace(',', '.');
                }
                if (!/^\d+\.\d+$/.test(cleanTargetTs)) {
                  const numbers = cleanTargetTs.replace(/[^\d]/g, '');
                  if (numbers.length >= 10) {
                    const dotPos = Math.min(10, Math.floor(numbers.length/2));
                    cleanTargetTs = numbers.slice(0, dotPos) + '.' + numbers.slice(dotPos);
                  }
                }
              }
              
              console.log('[SUMMARY] Using cleaned targetTs:', cleanTargetTs);
              
              // Also try GET method for alternative approach
              console.log('[SUMMARY] Trying alternative timestamp with GET method');
              const altResponse = await fetch(`https://slack.com/api/conversations.replies?channel=${encodeURIComponent(channelId)}&ts=${encodeURIComponent(cleanTargetTs)}`, {
                method: 'GET',
                headers: {
                  Authorization: `Bearer ${env.Slack_Bot_Token}`,
                  'Accept': 'application/json',
                }
              });
              
              const altData = await altResponse.json();
              
              if (altData.ok && altData.messages && altData.messages.length > 0) {
                console.log('[SUMMARY] Success with alternative approach!', altData.messages.length, 'messages');
                messages = altData.messages;
                contextType = 'thread';
                replyToTs = targetTs;
                return; // Skip to AI processing since we have messages now
              } else {
                console.warn('[SUMMARY] Alternative approach also failed:', altData.error);
              }
            } catch (altErr) {
              console.error('[SUMMARY] Error in alternative approach:', altErr.message);
            }
          }
          
          // Continue to next approach if all thread approaches fail
        }
      } catch (threadErr) {
        console.warn('[SUMMARY] Error fetching thread:', threadErr.message);
        // Continue to next approach
      }
    }
    
    // APPROACH B: If we don't have messages and have a target message, get it with surrounding context
    if (messages.length === 0 && targetTs) {
      try {
        console.log('[SUMMARY] Getting message with context for ts:', targetTs);
        
        // Get a few messages before the target message for context
        const beforeResponse = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channelId)}&latest=${encodeURIComponent(targetTs)}&limit=3&inclusive=false`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${env.Slack_Bot_Token}`,
            'Accept': 'application/json',
          }
        });
        
        const beforeData = await beforeResponse.json();
        let contextMessages = [];
        
        if (beforeData.ok && beforeData.messages && beforeData.messages.length > 0) {
          console.log('[SUMMARY] Got', beforeData.messages.length, 'messages before the target');
          // Reverse to get chronological order
          contextMessages = [...beforeData.messages].reverse();
        }
        
        // Get the target message
        const targetResponse = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channelId)}&latest=${encodeURIComponent(targetTs)}&limit=1&inclusive=true`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${env.Slack_Bot_Token}`,
            'Accept': 'application/json',
          }
        });
        
        const targetData = await targetResponse.json();
        
        if (targetData.ok && targetData.messages && targetData.messages.length > 0) {
          console.log('[SUMMARY] Successfully got target message');
          // Add the target message to context
          contextMessages.push(...targetData.messages);
          
          // Get a few messages after the target for additional context
          const afterTimestamp = (parseFloat(targetTs) + 0.000001).toString();
          const afterResponse = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channelId)}&oldest=${encodeURIComponent(afterTimestamp)}&limit=2`, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${env.Slack_Bot_Token}`,
              'Accept': 'application/json',
            }
          });
          
          const afterData = await afterResponse.json();
          
          if (afterData.ok && afterData.messages && afterData.messages.length > 0) {
            console.log('[SUMMARY] Got', afterData.messages.length, 'messages after the target');
            // Messages are already in reverse chronological order, so reverse them
            contextMessages.push(...afterData.messages.reverse());
          }
          
          // If we got any messages, use them
          if (contextMessages.length > 0) {
            messages = contextMessages;
            contextType = contextMessages.length > 1 ? 'context' : 'single';
            replyToTs = targetTs;  // Reply to the specific message
            console.log('[SUMMARY] Using message with surrounding context:', messages.length, 'total messages');
          } else {
            console.warn('[SUMMARY] Failed to get message context');
            // Continue to next approach
          }
        } else {
          console.warn('[SUMMARY] Failed to get target message:', targetData.error);
          // Continue to next approach
        }
      } catch (singleErr) {
        console.warn('[SUMMARY] Error fetching message with context:', singleErr.message);
        // Continue to next approach
      }
    }
    
    // APPROACH C: Fallback to recent conversation if we still don't have messages
    if (messages.length === 0) {
      try {
        console.log('[SUMMARY] Falling back to recent conversation');
        
        const historyResponse = await fetch(`https://slack.com/api/conversations.history`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.Slack_Bot_Token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            channel: channelId,
            limit: 10,  // Get 10 most recent messages
          }),
        });
        
        const historyData = await historyResponse.json();
        
        if (historyData.ok && historyData.messages && historyData.messages.length > 0) {
          console.log('[SUMMARY] Got', historyData.messages.length, 'recent messages');
          messages = historyData.messages;
          contextType = 'recent';
          replyToTs = null;  // Post as new message for recent context
        } else {
          console.error('[SUMMARY] Failed to get recent messages:', historyData.error);
          throw new Error(`Could not fetch any messages: ${historyData.error}`);
        }
      } catch (historyErr) {
        console.error('[SUMMARY] Error fetching recent messages:', historyErr.message);
        throw new Error(`Could not fetch recent messages: ${historyErr.message}`);
      }
    }
    
    // 5. Make sure we have messages to summarize
    if (messages.length === 0) {
      throw new Error('No messages available to summarize');
    }
    
    // 6. Format the messages for the AI with user information if available
    console.log(`[SUMMARY] Summarizing ${messages.length} messages (${contextType} context)`);
    
    // Try to fetch user information for better context
    // Map of user IDs to display names
    const userMap = {};
    
    // Try to get user names for all unique users in the messages
    try {
      const uniqueUserIds = [...new Set(messages.filter(msg => msg.user).map(msg => msg.user))];
      
      if (uniqueUserIds.length > 0) {
        console.log('[SUMMARY] Fetching user info for', uniqueUserIds.length, 'users');
        
        if (isVerboseLogging(env)) {
          console.log('[SUMMARY-VERBOSE] User IDs to fetch:', uniqueUserIds);
        }
        
        // Fetch user information in parallel
        await Promise.all(uniqueUserIds.map(async (userId) => {
          try {
            if (isVerboseLogging(env)) {
              console.log('[SUMMARY-VERBOSE] Fetching user info for ID:', userId);
            }
            
            const userResponse = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${env.Slack_Bot_Token}`,
                'Accept': 'application/json',
              }
            });
            
            const userData = await userResponse.json();
            
            if (userData.ok && userData.user) {
              // Use real_name or display_name or fallback to the user ID
              const userName = userData.user.real_name || 
                              (userData.user.profile && userData.user.profile.display_name) || 
                              userId;
              userMap[userId] = userName;
              
              if (isVerboseLogging(env)) {
                console.log(`[SUMMARY-VERBOSE] User ${userId} resolved to: ${userName}`);
                console.log(`[SUMMARY-VERBOSE] User details:`, {
                  id: userId,
                  real_name: userData.user.real_name,
                  display_name: userData.user.profile?.display_name,
                  is_bot: userData.user.is_bot
                });
              }
            } else {
              if (isVerboseLogging(env)) {
                console.log(`[SUMMARY-VERBOSE] Failed to get user info:`, userData);
              }
            }
          } catch (userErr) {
            console.warn('[SUMMARY] Error fetching user info for', userId, userErr.message);
            if (isVerboseLogging(env)) {
              console.error('[SUMMARY-VERBOSE] User fetch error details:', userErr);
            }
          }
        }));
        
        if (isVerboseLogging(env)) {
          console.log('[SUMMARY-VERBOSE] Completed user map:', userMap);
        }
      }
    } catch (userMapErr) {
      console.warn('[SUMMARY] Error creating user map:', userMapErr.message);
      if (isVerboseLogging(env)) {
        console.error('[SUMMARY-VERBOSE] User map error details:', userMapErr);
      }
    }
    
    // Format messages with user names when available
    const formattedMessages = messages.map(msg => {
      const userName = msg.user ? (userMap[msg.user] || msg.user) : 'User';
      return {
        userName,
        userId: msg.user,
        text: msg.text || '[no text]',
        ts: msg.ts,
        isHighlighted: (msg.ts === targetTs) // Mark the target message for emphasis
      };
    });
    
    if (isVerboseLogging(env)) {
      console.log('[SUMMARY-VERBOSE] Formatted messages with user info:', formattedMessages);
    }
    
    // Convert to text with special formatting for the target message
    const messageText = formattedMessages
      .map(msg => {
        // Highlight the target message in the context if applicable
        if (contextType === 'context' && msg.isHighlighted) {
          return `>> ${msg.userName}: ${msg.text} <<`;
        } else {
          return `${msg.userName}: ${msg.text}`;
        }
      })
      .join('\n');
    
    // 7. Limit text size if needed
    const truncatedText = messageText.length > 10000 
      ? messageText.substring(0, 10000) + '... (truncated)' 
      : messageText;
    
    // 8. Call the AI API with appropriate prompt
    const promptMap = {
      'thread': 'Summarize this conversation thread:',
      'single': 'Summarize this message:',
      'context': 'Summarize this message with its surrounding context:',
      'recent': 'Summarize these recent messages from a conversation:'
    };
    
    const prompt = promptMap[contextType] || 'Summarize this:';
    
    const aiRes = await fetch(env.AIRIA_API_URL, {
      method: 'POST',
      headers: {
        'X-API-KEY': env.Airia_API_key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        userInput: `${prompt} ${truncatedText}`, 
        asyncOutput: false
      }),
    });
    
    if (!aiRes.ok) {
      throw new Error(`AI API returned error: ${aiRes.status}`);
    }
    
    // 9. Process the AI response
    const aiJson = JSON.parse(await aiRes.text());
    if (!aiJson.result) {
      throw new Error('AI response missing expected "result" field');
    }
    
    // 10. Create a title and format summary
    const titleMap = {
      'thread': '*Thread Summary:*',
      'single': '*Message Summary:*',
      'context': '*Message Context Summary:*',
      'recent': '*Conversation Summary:*'
    };
    
    const title = titleMap[contextType] || '*Summary:*';
    const formattedSummary = `${title}\n${aiJson.result}`;
    
    // 11. Post the summary
    try {
      if (replyToTs) {
        // Try to post as a reply with the primary timestamp
        try {
          await postSlackMessage(env, channelId, formattedSummary, replyToTs);
          console.log(`[SUMMARY] Posted summary as a reply to message ${replyToTs}`);
        } catch (replyErr) {
          console.warn(`[SUMMARY] Failed to post as reply to ${replyToTs}: ${replyErr.message}`);
          
          // If we're in a thread but the main timestamp failed, try the targeting timestamp
          if (contextType === 'thread' && targetTs && targetTs !== replyToTs) {
            try {
              console.log(`[SUMMARY] Trying alternate timestamp for thread reply: ${targetTs}`);
              await postSlackMessage(env, channelId, formattedSummary, targetTs);
              console.log(`[SUMMARY] Posted summary as reply using alternate timestamp ${targetTs}`);
              return;
            } catch (altErr) {
              console.warn(`[SUMMARY] Failed with alternate timestamp too: ${altErr.message}`);
            }
          }
          
          // If all reply attempts failed, post as a new message
          console.warn(`[SUMMARY] All reply attempts failed, sending as new message`);
          
          // Add a note to the message explaining it should have been a reply
          const notePrefix = contextType === 'thread' 
            ? '*Note: This summary was meant to be posted in the thread but failed. Thread summary:*\n\n'
            : '*Note: This should have been a reply but failed. Message summary:*\n\n';
          
          await postSlackMessage(env, channelId, notePrefix + formattedSummary);
          console.log(`[SUMMARY] Posted summary as a new message (fallback) with note`);
        }
      } else {
        // Post as new message (for recent conversation context)
        await postSlackMessage(env, channelId, formattedSummary);
        console.log('[SUMMARY] Posted summary as a new message');
      }
      
      // Always log that the summary was successfully posted
      console.log('[SUMMARY-SUCCESS] Successfully posted summary', {
        type: contextType,
        messageCount: messages.length,
        replyToTs: replyToTs || 'none (posted as new message)'
      });
    } catch (postErr) {
      // If everything fails, try one last simple message
      try {
        const errorMsg = `*Summary* (Error posting full response: ${postErr.message})\n\n${aiJson.result.substring(0, 1000)}...`;
        await postSlackMessage(env, channelId, errorMsg);
        console.log('[SUMMARY] Posted simplified summary after errors');
      } catch (finalErr) {
        throw new Error(`Failed to post any summary: ${finalErr.message}`);
      }
    }
    
  } catch (err) {
    // Global error handler
    console.error('[SUMMARY] Error:', err);
    
    // Try to notify the user
    try {
      // Extract channel and user IDs with fallbacks
      const channelId = (
        (payload.channel && payload.channel.id) || 
        (payload.channel && typeof payload.channel === 'string' && payload.channel) || 
        (payload.message && payload.message.channel)
      );
      
      const userId = (
        (payload.user && payload.user.id) || 
        (payload.user && typeof payload.user === 'string' && payload.user) || 
        payload.user_id
      );
      
      if (channelId && userId) {
        await postEphemeralMessage(env, {
          channel: channelId,
          user: userId,
          text: `Error summarizing content: ${err.message}`,
        });
      }
    } catch (notifyErr) {
      console.error('[SUMMARY] Failed to notify user of error:', notifyErr);
    }
  }
}

/**
 * Handles "Ask AI Assistant" global shortcut
 * Opens a modal dialog for users to ask a question from anywhere
 */
async function processAskAiriaShortcut(payload, env) {
  console.log('[SHORTCUT] Processing Ask AI Assistant shortcut');
  console.log('[SHORTCUT] Payload:', JSON.stringify(payload, null, 2));
  
  try {
    // Validate the trigger ID is present
    if (!payload.trigger_id) {
      console.error('[SHORTCUT] Missing trigger_id in payload');
      return;
    }

    // Keep track of when the request was sent for timeout tracking
    const startTime = Date.now();
    
    // Open a modal for the user to input their question
    const modalView = {
      type: 'modal',
      callback_id: 'ask_ai_assistant_modal',
      title: {
        type: 'plain_text',
        text: 'Ask AI Assistant',
      },
      submit: {
        type: 'plain_text',
        text: 'Ask',
      },
      close: {
        type: 'plain_text',
        text: 'Cancel',
      },
      blocks: [
        {
          type: 'input',
          block_id: 'question_block',
          element: {
            type: 'plain_text_input',
            action_id: 'question',
            multiline: true,
            placeholder: {
              type: 'plain_text',
              text: 'What would you like to ask?',
            },
          },
          label: {
            type: 'plain_text',
            text: 'Question',
          },
        },
      ],
    };
    
    console.log('[SHORTCUT] Opening modal with trigger_id:', payload.trigger_id);
    
    // Set a timeout for the request - Slack needs fast responses
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    try {
      const modalResponse = await fetch('https://slack.com/api/views.open', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trigger_id: payload.trigger_id,
          view: modalView
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      const responseTime = Date.now() - startTime;
      console.log(`[SHORTCUT] Slack API response time: ${responseTime}ms`);
      
      if (!modalResponse.ok) {
        console.error('[SHORTCUT] HTTP error:', modalResponse.status, modalResponse.statusText);
        return;
      }
      
      const modalData = await modalResponse.json();
      console.log('[SHORTCUT] Modal response:', JSON.stringify(modalData, null, 2));
      
      if (!modalData.ok) {
        console.error('[SHORTCUT] Failed to open modal:', modalData.error);
        if (modalData.error === 'trigger_expired') {
          console.error('[SHORTCUT] Trigger ID expired (response took too long)');
        }
      } else {
        console.log('[SHORTCUT] Modal opened successfully with view ID:', modalData.view?.id);
      }
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        console.error('[SHORTCUT] Request timed out after 2000ms');
      } else {
        console.error('[SHORTCUT] Fetch error:', fetchErr);
      }
    }
  } catch (err) {
    console.error('[SHORTCUT] Error processing shortcut:', err);
  }
}

/**
 * Handle modal submissions 
 */
async function handleViewSubmission(payload, env) {
  const viewId = payload.view.id;
  const userId = payload.user.id;
  console.log(`[MODAL] Received submission from view ${viewId} by user ${userId}`);
  console.log('[MODAL] View structure:', JSON.stringify(payload.view, null, 2));

  try {
    // Extract the question from the modal submission - traverse the state structure carefully
    let question = '';
    
    try {
      // First try the expected structure
      question = payload.view.state.values.question_block.question.value;
    } catch (structErr) {
      // If that fails, log the error and try to find the question more broadly
      console.error('[MODAL] Error accessing question using expected structure:', structErr);
      console.log('[MODAL] Attempting to find question in view state');
      
      // Try to find any input with content
      if (payload.view.state && payload.view.state.values) {
        const blocks = Object.keys(payload.view.state.values);
        for (const block of blocks) {
          const actions = Object.keys(payload.view.state.values[block]);
          for (const action of actions) {
            const value = payload.view.state.values[block][action].value;
            if (value) {
              console.log(`[MODAL] Found input value in block ${block}, action ${action}`);
              question = value;
              break;
            }
          }
          if (question) break;
        }
      }
    }
    
    // Check if we found a question
    if (!question || question.trim() === '') {
      console.log('[MODAL] Empty question submitted or question not found in payload');
      // Since we're now handling this in the background, we can't return errors
      // so we'll just log the error and exit
      return;
    }
    
    console.log(`[MODAL] Processing question: ${question}`);
    
    // Get the user's DM channel to send the response
    const dmResponse = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.Slack_Bot_Token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        users: userId
      })
    });
    
    const dmData = await dmResponse.json();
    if (!dmData.ok) {
      console.error('[MODAL] Failed to open DM channel:', dmData.error);
      return;
    }
    
    const channelId = dmData.channel.id;
    
    // Send a "thinking" message
    try {
      await postSlackMessage(env, channelId, `:thinking_face: Processing your question: "${question}"`);
    } catch (msgErr) {
      console.error('[MODAL] Error sending thinking message:', msgErr);
      // Continue anyway - this is just a notification
    }
    
    // Call the AI API with proper error handling
    try {
      const aiRes = await fetch(env.AIRIA_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': env.Airia_API_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userInput: question, asyncOutput: false }),
      });
      
      if (!aiRes.ok) {
        console.error('[MODAL] AI API error:', aiRes.status, aiRes.statusText);
        await postSlackMessage(env, channelId, `Error processing your question: API returned status ${aiRes.status}. Please try again later.`);
        return;
      }
      
      const responseText = await aiRes.text();
      console.log('[MODAL] Raw AI response:', responseText);
      
      try {
        // Try to parse the JSON response
        const aiJson = JSON.parse(responseText);
        
        // Format response with better fallbacks
        const result = aiJson.result || aiJson.answer || aiJson.response || 
                     (typeof aiJson === 'string' ? aiJson : 'No readable response received');
        
        await postSlackMessage(env, channelId, `You asked: "${question}"\n\n*${result}*`);
        console.log('[MODAL] Replied to user question via DM');
      } catch (parseErr) {
        console.error('[MODAL] Error parsing AI response:', parseErr);
        // If we can't parse the JSON, just send the raw text as fallback
        await postSlackMessage(env, channelId, `You asked: "${question}"\n\n*Response:*\n${responseText.substring(0, 1500)}`);
      }
    } catch (aiErr) {
      console.error('[MODAL] Error calling AI API:', aiErr);
      await postSlackMessage(env, channelId, `Error calling AI service: ${aiErr.message}. Please try again later.`);
    }
  } catch (err) {
    console.error('[MODAL] Error processing modal submission:', err);
    try {
      // Try to notify the user about the error
      const dmResponse = await fetch('https://slack.com/api/conversations.open', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          users: userId
        })
      });
      
      if (dmResponse.ok) {
        const dmData = await dmResponse.json();
        if (dmData.ok) {
          await postSlackMessage(env, dmData.channel.id, 
            `Sorry, there was an error processing your request: ${err.message}. Please try again.`);
        }
      }
    } catch (notifyErr) {
      console.error('[MODAL] Failed to notify user of error:', notifyErr);
    }
  }
}

/**
 * Handles link unfurling for domains specified in the app manifest
 * 
 * CUSTOMIZATION REQUIRED:
 * 1. Change 'yourdomain.com' to your actual domain
 * 2. Add logic to fetch and display metadata for your links
 * 3. Update your Slack app configuration to include your domain 
 *    in the "App unfurl domains" section
 */
async function processLinkUnfurl(event, env) {
  console.log('[UNFURL] Processing link unfurl for links:', event.links);
  try {
    // Example of unfurling links from your domain
    const unfurls = {};
    
    for (const link of event.links) {
      // Change 'yourdomain.com' to your actual domain
      if (link.domain === 'yourdomain.com') {
        // You would typically fetch metadata about the link here
        // For demonstration, we'll create a simple unfurl
        unfurls[link.url] = {
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Link Preview from AI Assistant*\n${link.url}`,
              },
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: 'Powered by AI Assistant',
                },
              ],
            },
          ],
        };
      }
    }
    
    if (Object.keys(unfurls).length > 0) {
      const unfurlResponse = await fetch('https://slack.com/api/chat.unfurl', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: event.channel,
          ts: event.message_ts,
          unfurls,
        }),
      });
      
      const unfurlData = await unfurlResponse.json();
      if (!unfurlData.ok) {
        console.error('[UNFURL] Failed to unfurl links:', unfurlData.error);
      } else {
        console.log('[UNFURL] Links unfurled successfully');
      }
    }
  } catch (err) {
    console.error('[UNFURL] Error processing link unfurl:', err);
  }
}

/**
 * Handles the "Generate response" workflow step
 */
async function processWorkflowStep(payload, env) {
  console.log('[WORKFLOW] Processing workflow step:', payload.callback_id);
  
  try {
    if (payload.type === 'workflow_step_edit') {
      // Step 1: Open a configuration modal when user adds this step to a workflow
      await fetch('https://slack.com/api/workflows.updateStep', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_step_edit_id: payload.workflow_step.workflow_step_edit_id,
          inputs: {
            prompt: {
              value: "{{workflow_step_input}}",
              skip_variable_replacement: true,
            }
          },
          outputs: [
            {
              name: "response",
              type: "text",
              label: "AI Response"
            }
          ]
        })
      });
      console.log('[WORKFLOW] Configuration modal opened');
    }
    else if (payload.type === 'workflow_step_execute') {
      // Step 2: Execute the workflow step when triggered in a workflow
      const inputs = payload.workflow_step.inputs;
      const prompt = inputs.prompt.value;
      
      // Call Airia API with the input
      const aiRes = await fetch(env.AIRIA_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': env.Airia_API_key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userInput: prompt, asyncOutput: false }),
      });
      
      if (!aiRes.ok) {
        console.error('[WORKFLOW] Airia API error:', aiRes.status);
        await fetch('https://slack.com/api/workflows.stepFailed', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.Slack_Bot_Token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workflow_step_execute_id: payload.workflow_step.workflow_step_execute_id,
            error: {
              message: `Airia API error: ${aiRes.status}`
            }
          })
        });
        return;
      }
      
      // Parse response and complete the workflow step
      const aiJson = JSON.parse(await aiRes.text());
      await fetch('https://slack.com/api/workflows.stepCompleted', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_step_execute_id: payload.workflow_step.workflow_step_execute_id,
          outputs: {
            response: aiJson.result
          }
        })
      });
      console.log('[WORKFLOW] Workflow step completed successfully');
    }
  } catch (err) {
    console.error('[WORKFLOW] Error processing workflow step:', err);
    // Notify Slack that the step failed
    try {
      await fetch('https://slack.com/api/workflows.stepFailed', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.Slack_Bot_Token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_step_execute_id: payload.workflow_step.workflow_step_execute_id,
          error: {
            message: `Error: ${err.message}`
          }
        })
      });
    } catch (postErr) {
      console.error('[WORKFLOW] Failed to report workflow step failure:', postErr);
    }
  }
}

/**
 * Removed test route background logic for security
 * Any debugging functionality should be properly secured
 * and disabled in production environments
 */