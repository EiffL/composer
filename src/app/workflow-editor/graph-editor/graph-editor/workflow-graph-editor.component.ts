import {
    AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, TemplateRef, ViewChild,
    ViewEncapsulation
} from "@angular/core";
import {Workflow} from "cwl-svg";
import {StepModel, WorkflowFactory, WorkflowInputParameterModel, WorkflowModel, WorkflowOutputParameterModel} from "cwlts/models";
import {DataGatewayService} from "../../../core/data-gateway/data-gateway.service";
import {EditorInspectorService} from "../../../editor-common/inspector/editor-inspector.service";
import {StatusBarService} from "../../../layout/status-bar/status-bar.service";
import {DirectiveBase} from "../../../util/directive-base/directive-base";
import LoadOptions = jsyaml.LoadOptions;
import {IpcService} from "../../../services/ipc.service";


declare const Snap: any;

@Component({
    selector: "ct-workflow-graph-editor",
    encapsulation: ViewEncapsulation.None,
    styleUrls: ["./workflow-graph-editor.component.scss"],
    template: `
        <svg (dblclick)="openInspector($event)" #canvas class="cwl-workflow" tabindex="-1"
             [ct-drop-enabled]="true"
             [ct-drop-zones]="['zone1']"
             (onDropSuccess)="onDrop($event.detail.data.event, $event.detail.data.transfer_data)"></svg>

        <ng-template #controls>
            
            <span class="btn-group">
                    <button class="btn btn-sm btn-secondary" (click)="downscale()">-</button>
                    <button class="btn btn-sm btn-secondary"
                            (click)="graph.command('workflow.fit')">Fit to Viewport</button>
                    <button class="btn btn-sm btn-secondary" (click)="upscale()">+</button>
                
                </span>

        </ng-template>

        <!--Inspector Template -->
        <ng-template #inspector>
            <ct-editor-inspector-content>
                <div class="tc-header">
                    {{ inspectedNode.label || inspectedNode.id || inspectedNode.loc || typeOfInspectedNode()}}
                </div>
                <div class="tc-body">
                    <ct-workflow-step-inspector *ngIf="typeOfInspectedNode() === 'Step'"
                                                [step]="inspectedNode"
                                                [graph]="graph"
                                                [workflowModel]="model">
                    </ct-workflow-step-inspector>

                    <ct-workflow-io-inspector
                        *ngIf="typeOfInspectedNode() === 'Input' || typeOfInspectedNode() === 'Output'"
                        [port]="inspectedNode"
                        [graph]="graph"
                        [workflowModel]="model">

                    </ct-workflow-io-inspector>

                </div>
            </ct-editor-inspector-content>
        </ng-template>
    `
})
export class WorkflowGraphEditorComponent extends DirectiveBase implements OnChanges, OnInit, OnDestroy, AfterViewInit {

    @Input()
    public model: WorkflowModel;

    @Input()
    public readonly = false;

    @ViewChild("canvas")
    private canvas: ElementRef;

    @ViewChild("controls")
    private controlsTemplate: TemplateRef<any>;

    @ViewChild("inspector", {read: TemplateRef})
    private inspectorTemplate: TemplateRef<any>;

    inspectedNode: StepModel | WorkflowOutputParameterModel | WorkflowInputParameterModel = null;

    public graph: Workflow;

    private history = [];
    private future  = [];
    private historyHandler: (ev: KeyboardEvent) => void;

    private tryToFitWorkflowOnNextTabActivation = false;

    constructor(private statusBar: StatusBarService,
                private gateway: DataGatewayService,
                private ipc: IpcService,
                private inspector: EditorInspectorService) {
        super();
    }

    ngOnInit() {
        const removeHandler = (node) => {
            if (node === this.inspectedNode) {
                this.inspector.hide();
            }
        };

        this.tracked = this.model.on("output.remove", removeHandler);
        this.tracked = this.model.on("input.remove", removeHandler);
        this.tracked = this.model.on("step.remove", removeHandler);
    }

    private canvasIsInFocus() {
        const el = this.canvas.nativeElement;
        return el.getClientRects().length > 0 && (document.activeElement === el || el.contains(document.activeElement));
    }

    ngAfterViewInit() {

        if (Workflow.canDrawIn(this.canvas.nativeElement)) {
            this.drawGraphAndAttachListeners();
        } else {
            this.tryToFitWorkflowOnNextTabActivation = true;
        }
    }

    drawGraphAndAttachListeners() {
        this.graph = new Workflow(new Snap(this.canvas.nativeElement), this.model as any);
        this.graph.fitToViewport();


        this.graph.on("beforeChange", () => {
            if (this.history.length > 20) {
                this.history.shift();
            }
            this.history.push(this.model.serialize());
            this.future.length = 0;
        });

        this.tracked = this.ipc.watch("accelerator", "CmdOrCtrl+Z")
            .filter(() => this.canvasIsInFocus() && this.history.length > 0)
            .subscribe(() => {
                console.log("Undo");
                this.future.push(this.model.serialize());
                const hist = this.history.pop();
                this.model = WorkflowFactory.from(hist);
                this.graph.redraw(this.model as any);
            });

        this.tracked = this.ipc.watch("accelerator", "Shift+CmdOrCtrl+Z")
            .filter(() => this.canvasIsInFocus() && this.future.length > 0)
            .subscribe(() => {
                console.log("Redo");
                const future = this.future.pop();
                this.history.push(this.model.serialize());
                this.model = WorkflowFactory.from(future);
                this.graph.redraw(this.model as any);
            });
    }


    ngOnChanges() {
        if (this.graph) {
            this.graph.redraw(this.model as any);
        }
        // if (firstAnything && firstAnything.customProps["sbg:x"] === undefined) {
        //     console.log("Should arrange");
        //     // this.graph.command("workflow.arrange");
        // }


        // this.statusBar.setControls(this.controlsTemplate);
    }

    upscale() {
        this.graph.command("workflow.scale", this.graph.getScale() + .1);
    }

    downscale() {
        if (this.graph.getScale() > .1) {
            this.graph.command("workflow.scale", this.graph.getScale() - .1);

        }
    }

    /**
     * Triggers when app is dropped on canvas
     */
    onDrop(ev: MouseEvent, nodeID: string) {
        console.log("Dropped!", nodeID);

        this.gateway.fetchFileContent(nodeID, true).subscribe((app: any) => {

            debugger;
            const step = this.model.addStepFromProcess(app);
            console.log("adding step", step);
            const coords = this.graph.translateMouseCoords(ev.clientX, ev.clientY);
            Object.assign(step.customProps, {
                "sbg:x": coords.x,
                "sbg:y": coords.y
            });

            this.graph.command("app.create.step", step);
        }, err => {
            console.warn("Could not add an app", err);
        });
    }

    /**
     * Triggers when click events occurs on canvas
     */
    openInspector(ev: Event) {
        let current = ev.target as Element;

        // Check if clicked element is a node or any descendant of a node (in order to open object inspector if so)
        while (current !== this.canvas.nativeElement) {
            if (this.hasClassSvgElement(current, "node")) {
                this.openNodeInInspector(current);
                break;
            }
            current = current.parentNode as Element;
        }
    }

    /**
     * Returns type of inspected node to determine which template to render for object inspector
     */
    typeOfInspectedNode() {
        if (this.inspectedNode instanceof StepModel) {
            return "Step";
        } else if (this.inspectedNode instanceof WorkflowInputParameterModel) {
            return "Input";
        } else {
            return "Output";
        }
    }

    /**
     * Open node in object inspector
     */
    private openNodeInInspector(node: Element) {

        let typeOfNode = "steps";

        if (this.hasClassSvgElement(node, "input")) {
            typeOfNode = "inputs";
        } else if (this.hasClassSvgElement(node, "output")) {
            typeOfNode = "outputs";
        }

        this.inspectedNode = this.model[typeOfNode].find((input) => input.id === node.getAttribute("data-id"));
        this.inspector.show(this.inspectorTemplate, this.inspectedNode.id);
    }

    /**
     * IE does not support classList property for old browsers and also SVG elements
     */
    private hasClassSvgElement(element: Element, className: string) {
        const elementClass = element.getAttribute("class") || "";
        return elementClass.split(" ").indexOf(className) > -1;
    }

    ngOnDestroy() {
        window.removeEventListener("keypress", this.historyHandler);
        this.inspector.hide();
    }

    checkOutstandingGraphFitting() {
        this.drawGraphAndAttachListeners();
        this.tryToFitWorkflowOnNextTabActivation = false;
    }
}
