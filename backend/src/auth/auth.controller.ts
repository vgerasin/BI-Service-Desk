import { Body, Controller, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/user.entity';

class LoginDto {
  @IsString() @MinLength(1) email: string;
  @IsString() @MinLength(1) password: string;
}

class ForgotPasswordDto {
  @IsEmail() email: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip;
    return this.authService.login(dto.email, dto.password, ip);
  }

  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'Если аккаунт существует, письмо с новым паролем отправлено' };
  }

  // Public: lets the login page know whether (and how) to show the SSO button.
  @Get('sso-config')
  ssoConfig() {
    return this.authService.ssoPublicConfig();
  }

  @Post('sso/callback')
  @HttpCode(200)
  ssoCallback(@Body() dto: { code: string; redirectUri: string }) {
    return this.authService.ssoCallback(dto.code, dto.redirectUri);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.authService.me(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Put('me')
  updateMe(@CurrentUser() user: User, @Body() dto: any) {
    return this.authService.updateMe(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/telegram-link')
  telegramLink(@CurrentUser() user: User) {
    return this.authService.telegramLink(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/telegram-unlink')
  telegramUnlink(@CurrentUser() user: User) {
    return this.authService.telegramUnlink(user.id);
  }
}
