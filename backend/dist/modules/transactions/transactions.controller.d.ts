import { TransactionsService } from './transactions.service';
export declare class TransactionsController {
    private readonly service;
    constructor(service: TransactionsService);
    findMine(actor: {
        id: string;
    }): Promise<({
        error: true;
    } & "Received a generic string")[]>;
    findAll(): Promise<({
        error: true;
    } & "Received a generic string")[]>;
}
