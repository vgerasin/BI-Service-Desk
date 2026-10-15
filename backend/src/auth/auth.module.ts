import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { SsoService } from './sso.service';
import { User } from '../users/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SettingsModule } from '../settings/settings.module';
import { ReportOwnersModule } from '../report-owners/report-owners.module';
import { getJwtSecret } from '../common/app-config';

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: process.env.JWT_EXPIRES_IN || '90d' },
    }),
    TypeOrmModule.forFeature([User]),
    NotificationsModule,
    SettingsModule,
    ReportOwnersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, SsoService],
  exports: [AuthService],
})
export class AuthModule {}
