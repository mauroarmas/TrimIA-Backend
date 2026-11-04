import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService, JwtPayload } from '../auth.service';

const extractToken = ExtractJwt.fromExtractors([
  ExtractJwt.fromAuthHeaderAsBearerToken(),
  ExtractJwt.fromUrlQueryParameter('token'),
]);

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: extractToken,
      passReqToCallback: true,
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  /**
   * Passport llama a validate() con el payload decodificado del JWT.
   * Lo que devolvamos acá queda en `req.user`.
   */
  async validate(req: Request, payload: JwtPayload) {
    const token = extractToken(req);
    if (!token || !payload.exp) throw new UnauthorizedException();
    const sessionId = createHash('sha256').update(token).digest('hex');
    if (await this.auth.isSessionRevoked(sessionId)) {
      throw new UnauthorizedException('La sesión fue cerrada');
    }
    // Los permisos del JWT pueden haber cambiado desde el inicio de sesión.
    const identity = await this.auth.currentIdentity(payload.sub);
    return {
      ...identity,
      sessionId,
      // Lo necesitan los streams del panel para cerrarse cuando la sesión vence
      // (spec 004, RF-022): los guards corren UNA sola vez, al abrir la ruta, y
      // una conexión larga sobreviviría al token sin esto.
      exp: payload.exp,
    };
  }
}
