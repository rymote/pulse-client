export type EventListener = (data: any, context: { params: { [key: string]: string } }) => void;
