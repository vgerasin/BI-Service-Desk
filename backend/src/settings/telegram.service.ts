import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { SettingsService } from './settings.service';
import { TELEGRAM_MODULES, isModuleEnabled } from './telegram-modules';
import { User } from '../users/user.entity';

export interface InlineButton { text: string; callback_data: string; }

// Pure Bot API client — credentials, HTTP plumbing, and the two outbound send paths (admin
// group broadcast, personal DM). Deliberately has NO knowledge of requests/statuses/commands:
// that orchestration lives in TelegramBotModule, which depends on both this (SettingsModule)
// and RequestsModule — keeping the dependency direction one-way avoids a module cycle (this
// service is itself injected INTO RequestsService for the send side).
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  // api.telegram.org is unreachable from some hosting networks (periodic/regional blocking).
  // If a proxy URL is configured (http://user:pass@host:port or socks5://...), route Bot API
  // calls through it instead of the plain global fetch. Node's built-in fetch has no proxy
  // support of its own, hence pulling in undici directly just for this. Cached by URL so
  // editing the proxy setting takes effect on the next send without a restart.
  private proxyAgent: ProxyAgent | undefined;
  private proxyAgentUrl: string | undefined;

  // getMe() result, cached for the process lifetime — the bot's own username never changes
  // while a given token is valid, and we need it on every "Привязать Telegram" click to build
  // the t.me/<username>?start=<token> deep link.
  private botUsernameCache: { token: string; username: string } | undefined;

  constructor(
    private readonly settings: SettingsService,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
  ) {}

  private getProxyAgent(url: string): ProxyAgent {
    if (this.proxyAgent && this.proxyAgentUrl === url) return this.proxyAgent;
    this.proxyAgent = new ProxyAgent(url);
    this.proxyAgentUrl = url;
    return this.proxyAgent;
  }

  // Tolerates the most common copy-paste mistake: pasting the whole chat URL
  // (https://web.telegram.org/a/#-100123..., https://t.me/c/123.../45) instead of just the
  // numeric id. Bot API chat_id must be a bare integer (or "@channelname") — anything else
  // comes back as "chat not found" with no hint that the value itself was the problem.
  private sanitizeChatId(raw: string): string {
    const trimmed = raw.trim();
    if (/^-?\d+$/.test(trimmed) || trimmed.startsWith('@')) return trimmed;
    const match = trimmed.match(/-?\d{5,}/);
    return match ? match[0] : trimmed;
  }

  async getCredentials(): Promise<{ token?: string; chatId?: string; threadId?: string; proxyUrl?: string }> {
    const values = await this.settings.getMany([
      'telegram_bot_token', 'telegram_chat_id', 'telegram_thread_id', 'telegram_proxy_url',
    ]);
    const token = (values.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '').trim() || undefined;
    const chatIdRaw = values.telegram_chat_id || process.env.TELEGRAM_CHAT_ID || '';
    const chatId = chatIdRaw ? this.sanitizeChatId(chatIdRaw) : undefined;
    const threadId = (values.telegram_thread_id || process.env.TELEGRAM_THREAD_ID || '').trim() || undefined;
    const proxyUrl = (values.telegram_proxy_url || process.env.TELEGRAM_PROXY_URL || '').trim() || undefined;
    return { token, chatId, threadId, proxyUrl };
  }

  async callBotApi(method: string, body?: Record<string, unknown>): Promise<any> {
    const { token, proxyUrl } = await this.getCredentials();
    if (!token) throw new Error('Токен бота не настроен');
    const dispatcher = proxyUrl ? this.getProxyAgent(proxyUrl) : undefined;
    const res = await undiciFetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`);
    }
    return res.json();
  }

  // Low-level send to an arbitrary chat id — shared by the admin-group send() below and by
  // sendToUser() for personal DMs (which never has a thread id; topics only exist in
  // supergroups, not 1:1 chats). `buttons` renders as one inline-keyboard row per sub-array.
  private async deliver(chatId: string, threadId: string | undefined, text: string, buttons?: InlineButton[][]): Promise<{ sent: boolean; error?: string }> {
    try {
      await this.callBotApi('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...(threadId ? { message_thread_id: Number(threadId) } : {}),
        ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {}),
      });
      return { sent: true };
    } catch (e) {
      this.logger.warn(`Отправка в Telegram не удалась (chat ${chatId}): ${e.message}`);
      return { sent: false, error: e.message };
    }
  }

  /** Raw send to the configured admin group/chat — bypasses module toggles. Used by the "test message" button. */
  async send(text: string): Promise<{ sent: boolean; error?: string }> {
    const { token, chatId, threadId } = await this.getCredentials();
    if (!token || !chatId) return { sent: false, error: 'Токен бота или ID чата не настроены' };
    return this.deliver(chatId, threadId, text);
  }

  /** Send gated by a module's on/off switch — the method every scheduled check should use. */
  async sendIfEnabled(moduleId: string, text: string): Promise<{ sent: boolean; error?: string }> {
    const keys = TELEGRAM_MODULES.map(m => `telegram_notify_${m.id}`);
    const values = await this.settings.getMany(keys);
    if (!isModuleEnabled(values, moduleId)) return { sent: false };
    return this.send(text);
  }

  // Personal DM to one user's own Telegram account (assignment / status change / comment) —
  // silent no-op if they haven't linked Telegram yet, same fire-and-forget shape as the email
  // notifications it runs alongside. `buttons` — e.g. quick status-change actions.
  async sendToUser(userId: number, text: string, buttons?: InlineButton[][]): Promise<{ sent: boolean; error?: string }> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user?.telegramChatId) return { sent: false, error: 'Telegram не привязан' };
    return this.deliver(user.telegramChatId, undefined, text, buttons);
  }

  async getBotUsername(): Promise<string> {
    const { token, proxyUrl } = await this.getCredentials();
    if (!token) throw new Error('Токен бота не настроен');
    if (this.botUsernameCache?.token === token) return this.botUsernameCache.username;
    const me = await this.callBotApi('getMe');
    const username = me?.result?.username;
    if (!username) throw new Error('Не удалось определить имя бота (getMe вернул пустой username)');
    this.botUsernameCache = { token, username };
    return username;
  }

  // Step 1 of the link flow: mint a one-time token and hand back a t.me deep link. The token
  // is resolved into a real chat id by TelegramBotService.pollUpdates() once the user presses
  // Start — bots can't message a user by @username, only by the chat id from an update the
  // user themself triggered, hence this whole indirection.
  async generateLinkToken(userId: number): Promise<{ deepLink: string }> {
    const { token } = await this.getCredentials();
    if (!token) throw new BadRequestException('Telegram-бот не настроен — обратитесь к администратору');
    let botUsername: string;
    try {
      botUsername = await this.getBotUsername();
    } catch (e) {
      throw new BadRequestException(`Не удалось связаться с Telegram-ботом: ${e.message}`);
    }
    const linkToken = randomBytes(16).toString('hex');
    await this.usersRepo.update(userId, { telegramLinkToken: linkToken });
    return { deepLink: `https://t.me/${botUsername}?start=${linkToken}` };
  }

  async unlink(userId: number): Promise<void> {
    await this.usersRepo.update(userId, { telegramChatId: null, telegramLinkToken: null });
  }
}
