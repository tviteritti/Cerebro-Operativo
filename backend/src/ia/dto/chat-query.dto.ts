import { IsString, MinLength } from 'class-validator';

export class ChatQueryDto {
  @IsString()
  @MinLength(3)
  question: string;
}
