import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RatingsService } from './ratings.service';
import { CsiAnswer } from './request-rating.entity';
import { ResolveRequestIdPipe } from '../requests/resolve-request-id.pipe';

@Controller('ratings')
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  @Get('survey/:token')
  getSurvey(@Param('token') token: string) {
    return this.ratingsService.getSurveyByToken(token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('request/:requestId')
  async getOrCreateForRequest(@Param('requestId', ResolveRequestIdPipe) requestId: number) {
    return this.ratingsService.createForRequest(requestId);
  }

  @Post('survey/:token')
  submitSurvey(
    @Param('token') token: string,
    @Body() dto: { answers: CsiAnswer[]; comment?: string },
  ) {
    return this.ratingsService.submitSurvey(token, dto);
  }
}
