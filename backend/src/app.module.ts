import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { IaModule } from './ia/ia.module';
import { User } from './users/entities/user.entity';
import { Project } from './projects/entities/project.entity';
import { ProjectMember } from './projects/entities/project-member.entity';
import { ProjectContext } from './ia/entities/project-context.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'cerebro'),
        password: configService.get<string>('DB_PASSWORD', 'cerebro_secret_2024'),
        database: configService.get<string>('DB_NAME', 'cerebro_operativo'),
        entities: [User, Project, ProjectMember, ProjectContext],
        synchronize: true, // Solo para desarrollo - desactivar en producción
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    UsersModule,
    ProjectsModule,
    IaModule,
  ],
})
export class AppModule {}
