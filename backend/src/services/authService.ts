import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { Actor, ActorRole, LoginDTO } from '../domain/types';
import { IActorRepo } from '../repository/interfaces';

export interface JwtPayload {
  actorId: string;
  role: ActorRole;
  email: string;
}

export class AuthService {
  constructor(
    private readonly actorRepo: IActorRepo,
    private readonly jwtSecret: string,
    private readonly jwtExpiresInSeconds: number = 8 * 60 * 60,
  ) {}

  async register(
    name: string,
    email: string,
    password: string,
    role: ActorRole,
    organization: string,
  ): Promise<Actor> {
    const existing = await this.actorRepo.findByEmail(email);
    if (existing) throw new Error('Email already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const actor: Actor = {
      id: uuidv4(),
      name,
      email,
      passwordHash,
      role,
      organization,
      createdAt: new Date(),
      isActive: true,
    };

    return this.actorRepo.create(actor);
  }

  async login(dto: LoginDTO): Promise<{ token: string; actor: Omit<Actor, 'passwordHash'> }> {
    const actor = await this.actorRepo.findByEmail(dto.email);
    if (!actor || !actor.isActive) throw new Error('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, actor.passwordHash);
    if (!valid) throw new Error('Invalid credentials');

    const payload: JwtPayload = { actorId: actor.id, role: actor.role, email: actor.email };
    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: this.jwtExpiresInSeconds });

    const { passwordHash: _omit, ...actorPublic } = actor;
    return { token, actor: actorPublic };
  }

  verifyToken(token: string): JwtPayload {
    return jwt.verify(token, this.jwtSecret) as JwtPayload;
  }
}
