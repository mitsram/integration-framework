/**
 * Snowflake Client for ETL pipeline validation.
 *
 * Queries Snowflake to validate that data fed by App1 through
 * Fivetran → Coalesce → Snowflake has landed correctly.
 */

import snowflake from "snowflake-sdk";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SnowflakeConfig {
  account: string;
  username: string;
  password: string;
  database: string;
  schema: string;
  warehouse: string;
  role?: string;
}

export interface OrderRow {
  ORDER_ID: string;
  CUSTOMER_ID: string;
  ORDER_DATE: string;
  TOTAL_AMOUNT: number;
  STATUS: string;
  CONFIRMATION_NUMBER: string;
  CREATED_AT: string;
}

export interface OrderItemRow {
  ORDER_ID: string;
  PRODUCT_ID: string;
  PRODUCT_NAME: string;
  QUANTITY: number;
  UNIT_PRICE: number;
}

// ── Snowflake Client ────────────────────────────────────────────────────────

export class SnowflakeClient {
  private connection: snowflake.Connection | null = null;

  constructor(private readonly config: SnowflakeConfig) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connection = snowflake.createConnection({
        account: this.config.account,
        username: this.config.username,
        password: this.config.password,
        database: this.config.database,
        schema: this.config.schema,
        warehouse: this.config.warehouse,
        role: this.config.role,
      });

      this.connection.connect((err) => {
        if (err) {
          reject(new Error(`Snowflake connection failed: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        resolve();
        return;
      }
      this.connection.destroy((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Execute a SQL query and return rows.
   */
  async query<T = Record<string, unknown>>(
    sql: string,
    binds: any[] = []
  ): Promise<T[]> {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        reject(new Error("Not connected to Snowflake"));
        return;
      }

      this.connection.execute({
        sqlText: sql,
        binds,
        complete: (err, _stmt, rows) => {
          if (err) {
            reject(new Error(`Query failed: ${err.message}`));
          } else {
            resolve((rows || []) as T[]);
          }
        },
      });
    });
  }

  /**
   * Validate that an order exists in Snowflake with expected data.
   */
  async getOrderById(orderId: string): Promise<OrderRow | null> {
    const rows = await this.query<OrderRow>(
      `SELECT ORDER_ID, CUSTOMER_ID, ORDER_DATE, TOTAL_AMOUNT,
              STATUS, CONFIRMATION_NUMBER, CREATED_AT
       FROM ORDERS
       WHERE ORDER_ID = ?`,
      [orderId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Validate order line items in Snowflake.
   */
  async getOrderItems(orderId: string): Promise<OrderItemRow[]> {
    return this.query<OrderItemRow>(
      `SELECT ORDER_ID, PRODUCT_ID, PRODUCT_NAME, QUANTITY, UNIT_PRICE
       FROM ORDER_ITEMS
       WHERE ORDER_ID = ?`,
      [orderId]
    );
  }

  /**
   * Get the row count for a table — useful for data freshness assertions.
   */
  async getRowCount(tableName: string): Promise<number> {
    const rows = await this.query<{ COUNT: number }>(
      `SELECT COUNT(*) as COUNT FROM ${tableName}`
    );
    return rows[0]?.COUNT ?? 0;
  }

  /**
   * Check if data has been synced recently (within the last N minutes).
   */
  async isDataFresh(
    tableName: string,
    timestampColumn: string,
    withinMinutes: number = 60
  ): Promise<boolean> {
    const rows = await this.query<{ FRESH_COUNT: number }>(
      `SELECT COUNT(*) as FRESH_COUNT
       FROM ${tableName}
       WHERE ${timestampColumn} >= DATEADD(minute, -?, CURRENT_TIMESTAMP())`,
      [withinMinutes]
    );
    return (rows[0]?.FRESH_COUNT ?? 0) > 0;
  }
}
