import { Component, OnInit, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { MatTableDataSource, MatSort, MatPaginator, MatDialog, MatDialogRef, PageEvent } from '@angular/material';
import { forkJoin, Subject, of } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { CouchService } from '../shared/couchdb.service';
import { filterSpecificFields, sortNumberOrString } from '../shared/table-helpers';
import { DialogsListService } from '../shared/dialogs/dialogs-list.service';
import { DialogsListComponent } from '../shared/dialogs/dialogs-list.component';
import { SubmissionsService } from '../submissions/submissions.service';
import { PlanetMessageService } from '../shared/planet-message.service';
import { StateService } from '../shared/state.service';
import { DialogsLoadingService } from '../shared/dialogs/dialogs-loading.service';
import { SelectionModel } from '@angular/cdk/collections';
import { findByIdInArray, filterById, itemsShown } from '../shared/utils';
import { debug } from '../debug-operator';
import { DialogsPromptComponent } from '../shared/dialogs/dialogs-prompt.component';

@Component({
  'templateUrl': './surveys.component.html',
  styles: [ `
    /* Column Widths */
    .mat-column-select {
      max-width: 44px;
    }
    .mat-column-taken {
      max-width: 150px;
    }
    .mat-column-createdDate {
      max-width: 130px;
    }
  ` ]
})
export class SurveysComponent implements OnInit, AfterViewInit, OnDestroy {
  selection = new SelectionModel(true, []);
  surveys = new MatTableDataSource();
  @ViewChild(MatSort) sort: MatSort;
  @ViewChild(MatPaginator) paginator: MatPaginator;
  displayedColumns = [ 'select', 'name', 'taken', 'createdDate', 'action' ];
  dialogRef: MatDialogRef<DialogsListComponent>;
  private onDestroy$ = new Subject<void>();
  readonly dbName = 'exams';
  emptyData = false;
  isAuthorized = false;
  deleteDialog: any;
  message = '';

  constructor(
    private couchService: CouchService,
    private dialogsListService: DialogsListService,
    private submissionsService: SubmissionsService,
    private planetMessageService: PlanetMessageService,
    private dialog: MatDialog,
    private router: Router,
    private route: ActivatedRoute,
    private stateService: StateService,
    private dialogsLoadingService: DialogsLoadingService
  ) {
    this.dialogsLoadingService.start();
  }

  ngOnInit() {
    this.surveys.filterPredicate = filterSpecificFields([ 'name' ]);
    this.surveys.sortingDataAccessor = sortNumberOrString;
    this.receiveData('exams', 'surveys').pipe(switchMap(data => {
        this.surveys.data = data;
        return this.receiveData('submissions', 'survey');
      }))
      .subscribe((submissions: any) => {
        this.surveys.data = this.surveys.data.map(
          (survey: any) => ({
            ...survey,
            taken: submissions.filter(data => {
                return data.parentId === survey._id && data.status !== 'pending';
            }).length
          })
        );
        this.emptyData = !this.surveys.data.length;
        this.dialogsLoadingService.stop();
      });
    this.couchService.checkAuthorization(this.dbName).subscribe((isAuthorized) => this.isAuthorized = isAuthorized);
  }

  ngAfterViewInit() {
    this.surveys.sort = this.sort;
    this.surveys.paginator = this.paginator;
  }

  onPaginateChange(e: PageEvent) {
    this.selection.clear();
  }

  ngOnDestroy() {
    this.onDestroy$.next();
    this.onDestroy$.complete();
  }

  receiveData(dbName: string, type: string) {
    return this.couchService.findAll(dbName, { 'selector': { 'type': type } });
  }

  goBack() {
    this.router.navigate([ '../' ], { relativeTo: this.route });
  }

  routeToEditSurvey(route, id = '') {
    this.router.navigate([ route + '/' + id, { 'type': 'surveys' } ], { relativeTo: this.route });
  }

  applyFilter(filterValue: string) {
    this.surveys.filter = filterValue;
  }

  isAllSelected() {
    return this.selection.selected.length === itemsShown(this.paginator);
  }

  masterToggle() {
    const start = this.paginator.pageIndex * this.paginator.pageSize;
    const end = start + this.paginator.pageSize;
    if (this.isAllSelected()) {
      this.selection.clear();
    } else {
      this.surveys.filteredData.slice(start, end).forEach((row: any) => this.selection.select(row._id));
    }
  }

  deleteSelected() {
    const selected = this.selection.selected.map(surveyId => findByIdInArray(this.surveys.data, surveyId));
    if (selected.length === 1) {
      const survey = selected[0];
      this.openDeleteDialog(this.deleteSurvey(survey), 'single', survey.name);
    } else {
      this.openDeleteDialog(this.deleteSurveys(selected), 'many', '');
    }
  }

  deleteSurveys(surveys) {
    return () => {
      const deleteArray = surveys.map(survey => {
        this.surveys.data = filterById(this.surveys.data, survey._id);
        return { _id: survey._id, _rev: survey._rev, _deleted: true };
      });
      this.couchService.bulkDocs(this.dbName, deleteArray)
        .subscribe(() => {
          this.receiveData('exams', 'surveys');
          this.selection.clear();
          this.deleteDialog.close();
          this.planetMessageService.showMessage('You have deleted ' + deleteArray.length + ' surveys');
        }, () => this.deleteDialog.componentInstance.message = 'There was a problem deleting survey.');
    };
  }

  deleteSurvey(survey) {
    return () => {
      const { _id: surveyId, _rev: surveyRev } = survey;
      this.couchService.delete(this.dbName + '/' + surveyId + '?rev=' + surveyRev)
        .subscribe(() => {
          this.selection.deselect(survey._id);
          this.surveys.data = filterById(this.surveys.data, survey._id);
          this.deleteDialog.close();
          this.planetMessageService.showMessage('Survey deleted: ' + survey.name);
        }, () => this.deleteDialog.componentInstance.message = 'There was a problem deleting this survey.');
    };
  }

  openDeleteDialog(okClick, amount, displayName = '') {
    this.deleteDialog = this.dialog.open(DialogsPromptComponent, {
      data: {
        okClick,
        amount,
        changeType: 'delete',
        type: 'survey',
        displayName
      }
    });
    this.deleteDialog.afterClosed().pipe(debug('Closing dialog')).subscribe(() => {
      this.message = '';
    });
  }

  openSendSurveyDialog(survey) {
    this.getUserData(this.requestUsers()).subscribe((userData: {tableData: [], columns: []}) => {
      this.dialogRef = this.dialog.open(DialogsListComponent, {
        data: {
          ...userData,
          allowMulti: true,
          itemDescription: 'members',
          nameProperty: 'name',
          okClick: this.sendSurvey(survey).bind(this),
          dropdownSettings: {
            field: 'planetCode', startingValue: { value: this.stateService.configuration.code, text: 'Local' },
          },
          filterPredicate: filterSpecificFields([ 'name' ])
        },
        height: '500px',
        width: '600px',
        autoFocus: false
      });
    });
  }

  requestUsers() {
    return forkJoin([
      this.dialogsListService.getListAndColumns('_users'),
      this.dialogsListService.getListAndColumns('child_users'),
      this.couchService.findAll('communityregistrationrequests')
    ]);
  }

  getUserData(obs: any) {
    return obs.pipe(switchMap(([ users, childUsers, children ]) => {
      return of({
        tableData: [
          ...users.tableData,
          ...childUsers.tableData.filter((user: any) => {
            const planet = children.find((child: any) => user.planetCode === child.code);
            return planet && planet.registrationRequest !== 'pending';
          })
        ],
        columns: [ ...childUsers.columns ]
      });
    }));
  }

  sendSurvey(survey: any) {
    return (selectedUsers: string[]) => {
      this.submissionsService.sendSubmissionRequests(selectedUsers, {
        'parentId': survey._id, 'parent': survey }
      ).subscribe(() => {
        this.planetMessageService.showMessage('Survey requests sent');
        this.dialogRef.close();
      });
    };
  }

  recordSurvey(survey: any) {
    this.submissionsService.createSubmission(survey, 'survey').subscribe((res: any) => {
      this.router.navigate([
        'dispense',
        { questionNum: 1, submissionId: res.id, status: 'pending', mode: 'take' }
      ], { relativeTo: this.route });
    });
  }

}
