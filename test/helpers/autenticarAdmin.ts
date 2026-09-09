import { INestApplication } from '@nestjs/common';
import request from 'supertest';

export async function autenticarAdmin(app: INestApplication): Promise<string> {
  const response = await request(app.getHttpServer()).post('/auth/login').send({
    username: 'admin',
    password: 'admin12345',
  });

  return response.body.accessToken;
}
