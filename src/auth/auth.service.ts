import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { JwtService } from "@nestjs/jwt";
import { randomBytes } from "crypto";
import { Response } from "express";
import * as lnurl from "lnurl";
import { PayloadDto } from "src/auth/dto/payload.dto";
import { JWT_COOKIE_NAME } from "src/auth/guards/jwt.guard";
import {
  SESSION_COOKIE_NAME,
  SESSION_PREFIX,
} from "src/auth/guards/session.guard";
import { Challenge } from "src/auth/interfaces/challenge.interface";
import { Payload } from "src/auth/interfaces/payload.interface";
import { Token } from "src/auth/interfaces/token.interface";
import { StorageService } from "src/storage/storage.service";
import { expToDate } from "src/utils/date-utils";

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
    private storageService: StorageService
  ) {}

  async getToken(payload: Payload, response: Response): Promise<Token> {
    const jwt = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>("JWT_SECRET"),
      expiresIn: this.configService.get<string>("JWT_EXPIRATION"),
    });
    response.cookie(JWT_COOKIE_NAME, jwt, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      domain: this.configService.get<string>("COOKIES_DOMAIN"),
      expires: expToDate(this.configService.get<string>("JWT_EXPIRATION")),
    });
    return { ...payload, access_token: jwt };
  }

  async callback(k1: string, sig: string, key: string) {
    const session = await this.storageService.get(`${SESSION_PREFIX}/${k1}`);
    if (!session) {
      throw new Error("Unauthorized");
    }

    if (!lnurl.verifyAuthorizationSignature(sig, k1, key)) {
      throw new Error("Signature verification failed");
    }

    const payload: Payload = { sub: key };
    await this.storageService.set(`${SESSION_PREFIX}/${k1}`, payload);
    this.eventEmitter.emit(k1, new PayloadDto(payload));
  }

  async getChallenge(response: Response): Promise<Challenge> {
    const k1 = randomBytes(32).toString("hex");

    const params = new URLSearchParams({
      k1,
      tag: "login",
    });
    const appUrl = this.configService.get<string>("APP_URL");
    const callbackUrl = `${appUrl}/auth/callback?${params.toString()}`;

    await this.storageService.set(`${SESSION_PREFIX}/${k1}`, {}, "10m");
    response.cookie(SESSION_COOKIE_NAME, k1, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      domain: this.configService.get<string>("COOKIES_DOMAIN"),
      expires: expToDate(this.configService.get<string>("SESSION_EXPIRATION")),
    });
    return { k1, lnurl: lnurl.encode(callbackUrl).toUpperCase() };
  }
}
