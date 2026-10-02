import {
  Injectable,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Session lookup for /api/users/me — bypasses row-level scoping like AuthService does. */
  async findSessionUser(id: string): Promise<User | null> {
    return this.prisma.runAsAdmin((tx) => tx.user.findUnique({ where: { id } }));
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }
}
