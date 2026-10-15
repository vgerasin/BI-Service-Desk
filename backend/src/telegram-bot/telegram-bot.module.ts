import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramBotService } from './telegram-bot.service';
import { User } from '../users/user.entity';
import { SettingsModule } from '../settings/settings.module';
import { RequestsModule } from '../requests/requests.module';
import { TimeEntriesModule } from '../time-entries/time-entries.module';

// Depends on SettingsModule (TelegramService — the bare Bot API client), RequestsModule (to act
// on button taps / list tasks) and TimeEntriesModule (bot-driven "внести часы" flow). None of
// those import this module back, so the graph stays acyclic despite RequestsService also
// depending on SettingsModule directly for its own simple "fire a DM" notifications.
//
// No controller: updates come in via polling (see TelegramBotService.pollUpdates), not a
// webhook — Telegram's servers can't reliably reach this host inbound (tried a webhook, see the
// comment on TelegramBotService.onModuleInit for why it was reverted).
@Module({
  imports: [TypeOrmModule.forFeature([User]), SettingsModule, RequestsModule, TimeEntriesModule],
  providers: [TelegramBotService],
})
export class TelegramBotModule {}
