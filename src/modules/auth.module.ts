import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { LoginUseCase } from '../application/use-cases/auth/LoginUseCase';
import { AuthController } from '../interfaces/controllers/auth/AuthController';
import { JwtStrategy } from '../interfaces/strategies/JwtStrategy';
import { JwtClienteStrategy } from '../interfaces/strategies/JwtClienteStrategy';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.getOrThrow<string>('JWT_EXPIRES_IN') as any,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [LoginUseCase, JwtStrategy, JwtClienteStrategy],
  exports: [JwtModule, PassportModule, JwtStrategy, JwtClienteStrategy],
})
export class AuthModule {}
