import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { ZodSchema } from 'zod';
import { describeZodError } from '../validation/field-errors';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown) {
    try {
      const parsedValue = this.schema.parse(value);
      return parsedValue;
    } catch (error) {
      // "Validation failed" is kept for existing clients; `errors` names every failing field with an actionable Vietnamese sentence.
      throw new BadRequestException({ message: 'Validation failed', error: 'Bad Request', statusCode: 400, code: 'VALIDATION_FAILED', errors: describeZodError(error) }, { cause: error });
    }
  }
}
