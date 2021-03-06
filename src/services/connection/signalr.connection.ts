import { ISignalRConnection } from './i.signalr.connection';
import { Observable } from 'rxjs/Observable';
import { BroadcastEventListener } from '../eventing/broadcast.event.listener';
import { ConnectionStatus } from './connection.status';
import { NgZone } from '@angular/core';
import { Subject } from 'rxjs/Subject';
import { SignalRConfiguration } from '../signalr.configuration';
import { ConnectionTransport } from './connection.transport';

export class SignalRConnection implements ISignalRConnection {
    private _status: Observable<ConnectionStatus>;
    private _errors: Observable<any>;
    private _jConnection: any;
    private _jProxy: any;
    private _zone: NgZone;
    private _configuration: SignalRConfiguration;

    constructor(jConnection: any, jProxy: any, zone: NgZone, configuration: SignalRConfiguration) {
        this._jProxy = jProxy;
        this._jConnection = jConnection;
        this._zone = zone;
        this._errors = this.wireUpErrorsAsObservable();
        this._status = this.wireUpStatusEventsAsObservable();
        this._configuration = configuration;
    }

    public get errors(): Observable<any> {
        return this._errors;
    }

    public get status(): Observable<ConnectionStatus> {
        return this._status;
    }

    public start(): Promise<ISignalRConnection> {

        let jTransports = this.convertTransports(this._configuration.transport);

        let $promise = new Promise<ISignalRConnection>((resolve, reject) => {
                this._jConnection
                .start({
                        jsonp: this._configuration.jsonp,
                        transport: jTransports,
                        withCredentials: this._configuration.withCredentials,
                    })
                .done(() => {
                        console.log('Connection established, ID: ' + this._jConnection.id);
                        console.log('Connection established, Transport: ' + this._jConnection.transport.name);
                        resolve(this);
                    })
                .fail((error: any) => {
                        console.log('Could not connect');
                        reject('Failed to connect. Error: ' + error.message); // ex: Error during negotiation request.
                    });
            });
        return $promise;
    }

    public stop(): void {
        this._jConnection.stop();
    }

    public get id(): string {
        return this._jConnection.id;
    }

    public invoke(method: string, ...parameters: any[]): Promise<any> {
        if (method == null) {
            throw new Error('SignalRConnection: Failed to invoke. Argument \'method\' can not be null');
        }
        this.log(`SignalRConnection. Start invoking \'${method}\'...`);

        let $promise = new Promise<any>((resolve, reject) => {
            this._jProxy.invoke(method, ...parameters)
                .done((result: any) => {
                    this.log(`\'${method}\' invoked succesfully. Resolving promise...`);
                    resolve(result);
                    this.log(`Promise resolved.`);
                })
                .fail((err: any) => {
                    console.log(`Invoking \'${method}\' failed. Rejecting promise...`);
                    reject(err);
                    console.log(`Promise rejected.`);
                });
        });
        return $promise;
    }

    public listen<T>(listener: BroadcastEventListener<T>): void {
        if (listener == null) {
            throw new Error('Failed to listen. Argument \'listener\' can not be null');
        }

        this.log(`SignalRConnection: Starting to listen to server event with name ${listener.event}`);
        this._jProxy.on(listener.event, (...args: any[]) => {

            this._zone.run(() => {
                let casted: T = null;
                if (args.length === 1) {
                    casted = <T>args[0];
                }
                else if (args.length > 1)
                {
                    casted = <any>args;
                }
                this.log('SignalRConnection.proxy.on invoked. Calling listener next() ...');
                listener.next(casted);
                this.log('listener next() called.');
            });
        });
    }

    public listenFor<T>(event: string): BroadcastEventListener<T> {
        if (event == null || event === '') {
            throw new Error('Failed to listen. Argument \'event\' can not be empty');
        }

        let listener = new BroadcastEventListener<T>(event);

        this.listen(listener);

        return listener;
    }

    private convertTransports(transports: ConnectionTransport | ConnectionTransport[]): any {
        if (transports instanceof Array) {
            return transports.map((t: ConnectionTransport) => t.name);
        }
        return transports.name;
    }


    private wireUpErrorsAsObservable(): Observable<any> {
        let sError = new Subject<any>();

        this._jConnection.error((error: any) => {
            //this._zone.run(() => {  /*errors don't need to run in a  zone*/
            sError.next(error);
            //});
        });
        return sError;
    }

    private wireUpStatusEventsAsObservable(): Observable<ConnectionStatus> {
        let sStatus = new Subject<ConnectionStatus>();
        // aggregate all signalr connection status handlers into 1 observable.
        // handler wire up, for signalr connection status callback.
        this._jConnection.stateChanged((change: any) => {
            this._zone.run(() => {
                sStatus.next(new ConnectionStatus(change.newState));
            });
        });
        return sStatus;
    }

    private onBroadcastEventReceived<T>(listener: BroadcastEventListener<T>, ...args: any[]) {
        this.log('SignalRConnection.proxy.on invoked. Calling listener next() ...');

        let casted: T = null;
        if (args.length > 0) {
            casted = <T>args[0];
        }

        this._zone.run(() => {
            listener.next(casted);
        });

        this.log('listener next() called.');
    }

    private log(...args: any[]) {
        if (this._jConnection.logging === false) {
            return;
        }
        console.log(args.join(', '));
    }
}
