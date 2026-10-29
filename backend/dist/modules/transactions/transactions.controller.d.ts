import { TransactionsService } from './transactions.service';
import { CreateUatSimulationTransaction, TransactionReportQuery } from './transactions.dto';
export declare class TransactionsController {
    private readonly service;
    constructor(service: TransactionsService);
    reportMine(actor: {
        id: string;
    }, query: TransactionReportQuery): Promise<{
        items: ({
            error: true;
        } & "Received a generic string")[];
        page: number;
        page_size: number;
        total: number;
        page_count: number;
        summary: {
            transaction_count: number;
            document_total: string;
            document_discount_amount: string;
            commission_amount: string;
            payment_statuses: Record<string, number>;
            lifecycle_statuses: Record<string, number>;
            source_statuses: Record<string, number>;
            record_kinds: Record<string, number>;
        };
    }>;
    report(query: TransactionReportQuery): Promise<{
        items: ({
            error: true;
        } & "Received a generic string")[];
        page: number;
        page_size: number;
        total: number;
        page_count: number;
        summary: {
            transaction_count: number;
            document_total: string;
            document_discount_amount: string;
            commission_amount: string;
            payment_statuses: Record<string, number>;
            lifecycle_statuses: Record<string, number>;
            source_statuses: Record<string, number>;
            record_kinds: Record<string, number>;
        };
    }>;
    findMine(actor: {
        id: string;
    }): Promise<({
        error: true;
    } & "Received a generic string")[]>;
    createSimulation(actor: {
        id: string;
    }, dto: CreateUatSimulationTransaction): Promise<{
        record_kind: string;
        lifecycle_status: string;
        payment_status: string;
        external_settlement_enabled: boolean;
    }>;
    findAll(): Promise<({
        error: true;
    } & "Received a generic string")[]>;
}
