import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET'),
    });
  }

  /**
   * Passport llama a validate() con el payload decodificado del JWT.
   * Lo que devolvamos acá queda en `req.user`.
   */
  validate(payload: JwtPayload) {
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      sectorId: payload.sectorId,
      sectorName: payload.sectorName,
      isController: payload.isController,
      // Lo necesitan los streams del panel para cerrarse cuando la sesión vence
      // (spec 004, RF-022): los guards corren UNA sola vez, al abrir la ruta, y
      // una conexión larga sobreviviría al token sin esto.
      exp: payload.exp,
    };
  }
}
