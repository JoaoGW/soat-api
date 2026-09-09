import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LoginUseCase } from '../../../application/use-cases/auth/LoginUseCase';
import { LoginDto } from '../../dtos/auth/LoginDto';

@ApiTags('Autenticacao')
@Controller('auth')
export class AuthController {
  constructor(private readonly loginUseCase: LoginUseCase) {}

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Login administrativo' })
  @ApiResponse({
    status: 200,
    description: 'Login realizado com sucesso',
    schema: {
      example: { accessToken: 'jwt-token' },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Credenciais invalidas',
  })
  async login(@Body() body: LoginDto): Promise<{ accessToken: string }> {
    return this.loginUseCase.execute(body);
  }
}
