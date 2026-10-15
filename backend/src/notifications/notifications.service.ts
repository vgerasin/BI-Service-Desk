import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { IntegrationsService } from '../settings/integrations.service';
import { getAppName } from '../common/app-config';

const STATUS_COLORS: Record<string, string> = {
  new: '#1677ff', queued: '#722ed1',
  in_progress: '#fa8c16', review: '#13c2c2', rework: '#fa541c',
  done: '#52c41a', rejected: '#ff4d4f', cancelled: '#8c8c8c',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая', queued: 'В очереди',
  in_progress: 'В работе', review: 'На проверке', rework: 'На доработке',
  done: 'Выполнена', rejected: 'Отклонена', cancelled: 'Отменена',
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter | null = null;
  private transporterKey = '';

  constructor(private readonly integrations: IntegrationsService) {}

  /**
   * Mail is only sent for real when an SMTP host is configured (Settings → Почта, or SMTP_HOST in
   * the environment) — so a locally started copy never mails real people by accident.
   * The transport is rebuilt whenever the saved settings change.
   */
  private async getTransport(): Promise<{ transporter: nodemailer.Transporter; from: string } | null> {
    const cfg = await this.integrations.getSmtp();
    if (!cfg.host) return null;
    const key = JSON.stringify(cfg);
    if (!this.transporter || key !== this.transporterKey) {
      this.transporter = nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.secure === 'ssl',
        requireTLS: cfg.secure === 'starttls',
        auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
        tls: { rejectUnauthorized: cfg.rejectUnauthorized },
      });
      this.transporterKey = key;
    }
    return { transporter: this.transporter, from: cfg.from || `"${getAppName()}" <${cfg.user || 'noreply@localhost'}>` };
  }

  async sendPasswordReset(params: { to: string; toName: string; newPassword: string }) {
    const subject = `Восстановление пароля — ${getAppName()}`;
    const html = this.wrap(`
      <p style="color:#333;font-size:15px;margin:0 0 20px">
        Уважаемый(ая) <strong>${params.toName}</strong>,
      </p>
      <p style="color:#555;margin:0 0 20px">
        Был выполнен запрос на восстановление пароля для вашей учётной записи.
      </p>
      <div style="background:#f8f9fb;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <div style="font-size:13px;color:#888;margin-bottom:6px">Ваш новый пароль</div>
        <div style="font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:2px;font-family:monospace">
          ${params.newPassword}
        </div>
      </div>
      <p style="color:#555;font-size:14px;margin:0 0 12px">
        Войдите с этим паролем и сразу смените его на удобный вам.
      </p>
      <p style="color:#999;font-size:13px;margin:0">
        Если вы не запрашивали восстановление — просто проигнорируйте это письмо.
      </p>
    `);
    await this.send(params.to, subject, html);
  }

  async notifyRequestCreated(params: {
    to: string;
    toName: string;
    requestNumber: string;
    requestName: string;
    requestUrl: string;
  }) {
    const subject = `Заявка ${params.requestNumber} принята`;
    const html = this.wrap(`
      <p style="color:#333;font-size:15px;margin:0 0 20px">
        Уважаемый(ая) <strong>${params.toName}</strong>,
      </p>
      <p style="color:#555;margin:0 0 20px">Ваша заявка успешно создана:</p>
      <div style="background:#f8f9fb;border-radius:8px;padding:16px 20px;margin-bottom:24px">
        <div style="font-size:13px;color:#888;margin-bottom:6px">Заявка</div>
        <div style="font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:8px">
          ${params.requestNumber} — ${params.requestName}
        </div>
        <span style="background:#1677ff;color:#fff;padding:3px 10px;border-radius:6px;font-size:13px;font-weight:500">Новая</span>
      </div>
      <div style="text-align:center;margin-bottom:24px">
        <a href="${params.requestUrl}" style="display:inline-block;background:#1F4E79;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.3px">
          Открыть заявку
        </a>
      </div>
      <p style="color:#999;font-size:13px;margin:0">
        Отследить статус выполнения можно в личном кабинете портала.
      </p>
    `);
    await this.send(params.to, subject, html);
  }

  async notifyStatusChanged(params: {
    to: string;
    toName: string;
    requestNumber: string;
    requestName: string;
    prevStatus: string;
    newStatus: string;
    comment?: string;
    closeReason?: string;
    requestUrl?: string;
    surveyUrl?: string;
  }) {
    const prevLabel = STATUS_LABELS[params.prevStatus] || params.prevStatus;
    const newLabel = STATUS_LABELS[params.newStatus] || params.newStatus;
    const prevColor = STATUS_COLORS[params.prevStatus] || '#999';
    const newColor = STATUS_COLORS[params.newStatus] || '#1677ff';

    const subject = `Статус заявки ${params.requestNumber} изменён на «${newLabel}»`;
    const html = this.wrap(`
      <p style="color:#333;font-size:15px;margin:0 0 20px">
        Уважаемый(ая) <strong>${params.toName}</strong>,
      </p>
      <p style="color:#555;margin:0 0 20px">Статус вашей заявки был изменён:</p>
      <div style="background:#f8f9fb;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <div style="font-size:13px;color:#888;margin-bottom:6px">Заявка</div>
        <div style="font-size:15px;font-weight:600;color:#1a1a1a;margin-bottom:16px">
          ${params.requestNumber} — ${params.requestName}
        </div>
        <table style="border-collapse:collapse;margin-bottom:16px">
          <tr>
            <td style="padding:4px 8px 4px 0;color:#888;font-size:13px;white-space:nowrap">Было:</td>
            <td style="padding:4px 0">
              <span style="background:${prevColor};color:#fff;padding:3px 10px;border-radius:6px;font-size:13px;font-weight:500">${prevLabel}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px 4px 0;color:#888;font-size:13px;white-space:nowrap">Стало:</td>
            <td style="padding:4px 0">
              <span style="background:${newColor};color:#fff;padding:3px 10px;border-radius:6px;font-size:13px;font-weight:500">${newLabel}</span>
            </td>
          </tr>
        </table>
        ${params.closeReason ? `
        <div style="border-top:1px solid #e8e8e8;padding-top:14px;margin-top:4px">
          <div style="font-size:13px;color:#888;margin-bottom:6px">Причина закрытия:</div>
          <div style="font-size:14px;color:#333;font-weight:600">${params.closeReason}</div>
        </div>` : ''}
        ${params.comment ? `
        <div style="border-top:1px solid #e8e8e8;padding-top:14px;margin-top:4px">
          <div style="font-size:13px;color:#888;margin-bottom:6px">Комментарий:</div>
          <div style="font-size:14px;color:#333;white-space:pre-wrap">${params.comment}</div>
        </div>` : ''}
      </div>
      ${params.requestUrl ? `
      <div style="text-align:center;margin-bottom:${params.surveyUrl ? '12px' : '20px'}">
        <a href="${params.requestUrl}" style="display:inline-block;background:#1F4E79;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.3px">
          Открыть заявку
        </a>
      </div>` : `
      <p style="color:#555;font-size:14px;margin:0">
        Для просмотра деталей войдите в Портал разработки Power BI.
      </p>`}
      ${params.surveyUrl ? `
      <div style="text-align:center;margin-bottom:20px">
        <a href="${params.surveyUrl}" style="display:inline-block;background:#52c41a;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.3px">
          ★ Оценить выполнение
        </a>
      </div>
      <p style="color:#999;font-size:13px;margin:0;text-align:center">
        Ваша оценка помогает нам становиться лучше. Это займёт не более минуты.
      </p>` : ''}
    `);

    await this.send(params.to, subject, html);
  }

  async notifyRatingRequest(params: {
    to: string;
    toName: string;
    requestNumber: string;
    requestName: string;
    requestUrl: string;
    reminder?: boolean;
  }) {
    const subject = params.reminder
      ? `Напоминание: оцените выполнение заявки ${params.requestNumber}`
      : `Заявка ${params.requestNumber} выполнена — оцените результат`;
    const html = this.wrap(`
      <p style="color:#333;font-size:15px;margin:0 0 20px">
        Уважаемый(ая) <strong>${params.toName}</strong>,
      </p>
      <p style="color:#555;margin:0 0 20px">
        ${params.reminder
          ? 'Напоминаем: ваша заявка была выполнена, но вы пока не оценили качество выполнения работ. Пожалуйста, найдите минуту, чтобы это сделать.'
          : 'Ваша заявка была выполнена и передана в сопровождение. Пожалуйста, оцените качество выполнения работ.'}
      </p>
      <div style="background:#f8f9fb;border-radius:8px;padding:16px 20px;margin-bottom:24px">
        <div style="font-size:13px;color:#888;margin-bottom:6px">Заявка</div>
        <div style="font-size:15px;font-weight:600;color:#1a1a1a">
          ${params.requestNumber} — ${params.requestName}
        </div>
        <div style="margin-top:8px">
          <span style="background:#52c41a;color:#fff;padding:3px 10px;border-radius:6px;font-size:13px;font-weight:500">Сопровождение</span>
        </div>
      </div>
      <div style="text-align:center;margin-bottom:24px">
        <a href="${params.requestUrl}" style="display:inline-block;background:#1F4E79;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.3px">
          ★ Оценить выполнение
        </a>
      </div>
      <p style="color:#999;font-size:13px;margin:0">
        Ваша оценка помогает нам становиться лучше. Это займёт не более минуты.
      </p>
    `);
    await this.send(params.to, subject, html);
  }

  async notifyContractorAssigned(params: {
    to: string;
    toName: string;
    requestNumber: string;
    requestName: string;
    customerDepartment: string;
    plannedDate?: string;
    description?: string;
    requestUrl: string;
  }) {
    const subject = `Новая задача: ${params.requestNumber}`;
    const planned = params.plannedDate
      ? new Date(params.plannedDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : null;

    const html = this.wrap(`
      <p style="color:#333;font-size:15px;margin:0 0 20px">
        Уважаемый(ая) <strong>${params.toName}</strong>,
      </p>
      <p style="color:#555;margin:0 0 20px">Вам назначена новая заявка на разработку отчёта Power BI:</p>
      <div style="background:#f8f9fb;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <table style="width:100%;border-collapse:collapse">
          <tr>
            <td style="padding:6px 0;color:#888;font-size:13px;width:130px">Номер заявки</td>
            <td style="padding:6px 0;color:#1a1a1a;font-size:13px;font-weight:600">${params.requestNumber}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#888;font-size:13px">Наименование</td>
            <td style="padding:6px 0;color:#1a1a1a;font-size:14px;font-weight:600">${params.requestName}</td>
          </tr>
          ${params.customerDepartment ? `<tr>
            <td style="padding:6px 0;color:#888;font-size:13px">Заказчик</td>
            <td style="padding:6px 0;color:#1a1a1a;font-size:13px">${params.customerDepartment}</td>
          </tr>` : ''}
          ${planned ? `<tr>
            <td style="padding:6px 0;color:#888;font-size:13px">Срок выполнения</td>
            <td style="padding:6px 0;color:#1a1a1a;font-size:13px;font-weight:600">${planned}</td>
          </tr>` : ''}
          ${params.description ? `<tr>
            <td style="padding:6px 0;color:#888;font-size:13px;vertical-align:top">Описание</td>
            <td style="padding:6px 0;color:#555;font-size:13px">${params.description}</td>
          </tr>` : ''}
        </table>
      </div>
      <p style="color:#555;font-size:14px;margin:0 0 20px">
        Пожалуйста, ознакомьтесь с деталями задачи и приступите к выполнению в установленный срок.
      </p>
      <div style="text-align:center">
        <a href="${params.requestUrl}" style="display:inline-block;background:#1677ff;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600">
          Открыть заявку
        </a>
      </div>
    `);

    await this.send(params.to, subject, html);
  }

  async sendPortalInvite(params: {
    to: string; toName: string; department: string;
    login: string; password: string; portalUrl: string;
  }) {
    const subject = 'Доступ к порталу заявок — Система разработки Power BI';
    const html = this.wrap(`
      <p style="color:#333;font-size:15px;margin:0 0 20px">
        Уважаемый(ая) <strong>${params.toName}</strong>,
      </p>
      <p style="color:#555;margin:0 0 16px">
        Для подразделения <strong>${params.department}</strong> создан доступ к порталу заявок на разработку отчётов Power BI.
      </p>
      <div style="background:#f8f9fb;border-radius:8px;padding:16px 20px;margin-bottom:20px">
        <div style="font-size:13px;color:#888;margin-bottom:4px">Адрес портала</div>
        <div style="font-size:14px;font-weight:600;margin-bottom:12px">
          <a href="${params.portalUrl}" style="color:#1677ff">${params.portalUrl}</a>
        </div>
        <div style="font-size:13px;color:#888;margin-bottom:4px">Логин</div>
        <div style="font-size:15px;font-weight:600;margin-bottom:12px;font-family:monospace">${params.login}</div>
        <div style="font-size:13px;color:#888;margin-bottom:4px">Пароль</div>
        <div style="font-size:22px;font-weight:700;color:#1a1a1a;letter-spacing:2px;font-family:monospace">${params.password}</div>
      </div>
      <p style="color:#555;font-size:14px;margin:0 0 8px">
        Через портал вы сможете подавать новые заявки и отслеживать их статус.
      </p>
      <p style="color:#999;font-size:13px;margin:0">
        Если вы получили это письмо по ошибке — просто проигнорируйте его.
      </p>
    `);
    await this.send(params.to, subject, html);
  }

  async notifyNewComment(params: {
    to: string;
    toName: string;
    requestNumber: string;
    requestName: string;
    commentText: string;
    authorName: string;
    requestUrl: string;
  }) {
    const subject = `Новый комментарий к заявке ${params.requestNumber}`;
    const html = this.wrap(`
      <p style="color:#333;font-size:15px;margin:0 0 20px">
        Уважаемый(ая) <strong>${params.toName}</strong>,
      </p>
      <p style="color:#555;margin:0 0 16px">
        К заявке <strong>${params.requestNumber} — ${params.requestName}</strong> добавлен новый комментарий:
      </p>
      <div style="background:#f8f9fb;border-radius:8px;padding:16px 20px;margin-bottom:20px;border-left:3px solid #1677ff">
        <div style="font-size:12px;color:#888;margin-bottom:6px">${params.authorName}</div>
        <div style="font-size:14px;color:#333;white-space:pre-wrap">${params.commentText}</div>
      </div>
      <a href="${params.requestUrl}" style="display:inline-block;background:#1677ff;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">
        Открыть заявку
      </a>
    `);
    await this.send(params.to, subject, html);
  }

  async sendSlaEscalation(params: {
    to: string; toName: string;
    overdueRequests: any[]; appUrl: string;
  }) {
    const PRIORITY_LABELS: Record<string, string> = {
      critical: 'Критический', high: 'Высокий', medium: 'Средний', low: 'Низкий',
    };
    const rows = params.overdueRequests.map(r => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">
          <a href="${params.appUrl}/requests/${r.number}" style="color:#1677ff;text-decoration:none;font-weight:600">${r.number}</a>
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${r.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;color:#ff4d4f;font-weight:600">+${Math.round(r.overdueDays)} дн</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${PRIORITY_LABELS[r.priority] || r.priority}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;color:#888">${r.contractorName || '—'}</td>
      </tr>
    `).join('');
    const subject = `⚠️ SLA нарушен: ${params.overdueRequests.length} заявок просрочено`;
    const html = this.wrap(`
      <p style="color:#333;font-size:15px;margin:0 0 16px">
        Уважаемый(ая) <strong>${params.toName}</strong>,
      </p>
      <p style="color:#555;margin:0 0 16px">
        Следующие заявки <strong style="color:#ff4d4f">нарушили SLA</strong> и требуют вашего внимания:
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="background:#fff2f0">
          <th style="padding:8px;text-align:left;font-weight:600;color:#cf1322">№</th>
          <th style="padding:8px;text-align:left;font-weight:600;color:#cf1322">Заявка</th>
          <th style="padding:8px;text-align:left;font-weight:600;color:#cf1322">Просрочка</th>
          <th style="padding:8px;text-align:left;font-weight:600;color:#cf1322">Приоритет</th>
          <th style="padding:8px;text-align:left;font-weight:600;color:#cf1322">Исполнитель</th>
        </tr>
        ${rows}
      </table>
      <div style="margin-top:20px;text-align:center">
        <a href="${params.appUrl}/requests?status=in_progress" style="display:inline-block;background:#ff4d4f;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600">
          Открыть список заявок
        </a>
      </div>
    `);
    await this.send(params.to, subject, html);
  }

  async sendSlaNearBreach(params: {
    to: string; toName: string; requests: any[]; appUrl: string;
  }) {
    const rows = params.requests.map(r => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">
          <a href="${params.appUrl}/requests/${r.number}" style="color:#1677ff;text-decoration:none;font-weight:600">${r.number}</a>
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${r.name}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;color:#faad14;font-weight:600">${Math.round(r.daysLeft)} дн</td>
      </tr>
    `).join('');
    const subject = `⏰ Скоро нарушение SLA: ${params.requests.length} заявок`;
    const html = this.wrap(`
      <p style="color:#333;font-size:15px;margin:0 0 16px">
        Уважаемый(ая) <strong>${params.toName}</strong>,
      </p>
      <p style="color:#555;margin:0 0 16px">
        Следующие заявки <strong style="color:#faad14">истекают в ближайшие 1-2 дня</strong>:
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="background:#fffbe6">
          <th style="padding:8px;text-align:left;font-weight:600;color:#d48806">№</th>
          <th style="padding:8px;text-align:left;font-weight:600;color:#d48806">Заявка</th>
          <th style="padding:8px;text-align:left;font-weight:600;color:#d48806">Осталось</th>
        </tr>
        ${rows}
      </table>
      <div style="margin-top:20px;text-align:center">
        <a href="${params.appUrl}/requests" style="display:inline-block;background:#faad14;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:14px;font-weight:600">
          Открыть список заявок
        </a>
      </div>
    `);
    await this.send(params.to, subject, html);
  }

  private async send(to: string, subject: string, html: string) {
    const transport = await this.getTransport();
    if (!transport) {
      this.logger.warn(`SMTP не настроен — письмо НЕ отправлено: ${to} — ${subject}`);
      return;
    }
    try {
      await transport.transporter.sendMail({ from: transport.from, to, subject, html });
      this.logger.log(`Уведомление отправлено: ${to} — ${subject}`);
    } catch (err) {
      this.logger.error(`Ошибка отправки на ${to}: ${err.message}`);
    }
  }

  // Same as send(), but surfaces the result instead of only logging it — every other call
  // site is fire-and-forget, so a silent SMTP failure is otherwise invisible. Used by the
  // «Отправить тестовое письмо» button in Settings.
  async sendDiagnostic(to: string): Promise<{ sent: boolean; error?: string }> {
    const transport = await this.getTransport();
    if (!transport) return { sent: false, error: 'SMTP-сервер не указан' };
    try {
      await transport.transporter.sendMail({
        from: transport.from,
        to,
        subject: `Тестовое письмо — ${getAppName()}`,
        html: this.wrap('<p style="color:#333;font-size:14px">Это тестовое письмо для проверки SMTP-отправки.</p>'),
      });
      return { sent: true };
    } catch (err: any) {
      return { sent: false, error: err.message };
    }
  }

  private wrap(content: string): string {
    return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 16px;background:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto">
  <tr><td style="background:#fff;border-radius:10px 10px 0 0;padding:16px 24px;border-bottom:3px solid #007AFF">
    <div style="font-size:16px;font-weight:700;color:#1a1a1a">${getAppName()}</div>
    <div style="font-size:11px;color:#999;margin-top:4px;letter-spacing:0.5px">Портал заявок на разработку BI</div>
  </td></tr>
  <tr><td style="background:#fff;border-radius:0 0 10px 10px;padding:28px 24px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    ${content}
    <p style="color:#bbb;font-size:12px;margin:24px 0 0;border-top:1px solid #f0f0f0;padding-top:16px">
      Это автоматическое уведомление. Не отвечайте на это письмо.
    </p>
  </td></tr>
</table>
</body>
</html>`;
  }
}
