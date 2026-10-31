import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class ChatQueryDto {
  @IsString()
  @MinLength(3)
  question: string;

  /** Si es true, el backend permite herramientas: leer repo acotado + git pull / checkout de rama. */
  @IsOptional()
  @IsBoolean()
  useAgentTools?: boolean;
}
